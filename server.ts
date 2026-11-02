import express, { Request, Response } from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDeterministicBenchmark, runOutOfSampleTelemetryBenchmark } from './src/engine/benchmarks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Approved host destinations for proxy (SSRF protection & access governance)
const DEFAULT_APPROVED_HOSTS = [
  'localhost',
  '127.0.0.1',
  'prometheus',
  'otel-collector',
  'telemetry.internal',
  'monitoring.internal',
];

function getApprovedHosts(): string[] {
  const envHosts = process.env.APPROVED_TELEMETRY_HOSTS;
  if (envHosts) {
    return envHosts.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_APPROVED_HOSTS;
}

function isHostApproved(targetUrlStr: string): { approved: boolean; error?: string; url?: URL } {
  try {
    const parsed = new URL(targetUrlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { approved: false, error: 'Only http and https protocols are permitted' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block cloud metadata & link-local addresses
    if (
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      hostname === 'metadata.google.internal' ||
      hostname === '0.0.0.0'
    ) {
      return { approved: false, error: 'Access to cloud metadata and link-local destinations is forbidden' };
    }

    const approvedList = getApprovedHosts();
    const isExplicitlyApproved = approvedList.some(approved => {
      if (approved.startsWith('*.')) {
        return hostname.endsWith(approved.slice(1));
      }
      return hostname === approved || hostname.endsWith(`.${approved}`);
    });

    if (!isExplicitlyApproved && process.env.ALLOW_ALL_TELEMETRY_HOSTS !== 'true') {
      return {
        approved: false,
        error: `Host '${hostname}' is not in the approved telemetry destinations list. Approved hosts: ${approvedList.join(', ')}`,
      };
    }

    return { approved: true, url: parsed };
  } catch (err: any) {
    return { approved: false, error: `Invalid target URL: ${err.message}` };
  }
}

// In-memory ring buffer for recent ingested telemetry
interface RecentTelemetryRecord {
  receivedAtMs: number;
  source: string;
  sampleCount: number;
  data: any;
}
const recentTelemetryBuffer: RecentTelemetryRecord[] = [];
const MAX_RECENT_BUFFER = 50;

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Strict payload size limit (256KB) to prevent memory exhaustion / DoS
  app.use(express.json({ limit: '256kb' }));

  // Request timestamp header
  app.use((_req, res, next) => {
    res.setHeader('X-HRM-Bridge-Version', '4.1');
    next();
  });

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      version: 'HRM 4.1',
      engine: 'Helical Recursive Manifold',
      serverTimeMs: Date.now(),
    });
  });

  // Telemetry Health and Security Governance Endpoint
  app.get('/api/telemetry/health', (_req: Request, res: Response) => {
    return res.json({
      status: 'operational',
      bridgeSecurity: 'strict',
      approvedHosts: getApprovedHosts(),
      payloadLimit: '256kb',
      timeoutMs: 5000,
      recentBufferedTraces: recentTelemetryBuffer.length,
      serverTimeMs: Date.now(),
    });
  });

  // GET Recent Telemetry
  app.get('/api/telemetry/recent', (_req: Request, res: Response) => {
    return res.json({
      success: true,
      count: recentTelemetryBuffer.length,
      recent: recentTelemetryBuffer.slice(-10),
    });
  });

  // In-memory Rate Limiter
  const ipRateLimits = new Map<string, { count: number; resetAt: number }>();
  const rateLimiterMiddleware = (req: Request, res: Response, next: () => void) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 120; // 120 req/min

    const record = ipRateLimits.get(ip);
    if (!record || now > record.resetAt) {
      ipRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        error: `Rate limit of ${maxRequests} req/min exceeded for client ${ip}`,
        retryAfterSec: Math.ceil((record.resetAt - now) / 1000),
        timestamp: Date.now(),
      });
    }
    return next();
  };

  // Telemetry Auth Guard
  const telemetryAuthGuard = (req: Request, res: Response, next: () => void) => {
    const requiredKey = process.env.TELEMETRY_API_KEY;
    if (!requiredKey) return next();

    const authHeader = req.headers.authorization || (req.headers['x-api-key'] as string);
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token || token !== requiredKey) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED_INGESTION',
        error: 'Valid API key or bearer token required for telemetry access',
        timestamp: Date.now(),
      });
    }
    return next();
  };

  // Direct Ingestion Endpoint for OpenTelemetry OTLP Collectors (POST /api/telemetry/otlp)
  app.post('/api/telemetry/otlp', rateLimiterMiddleware, telemetryAuthGuard, (req: Request, res: Response) => {
    const payload = req.body;
    if (!payload || (!payload.resourceMetrics && !Array.isArray(payload))) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_OTLP_SCHEMA',
        error: 'Payload must contain standard OTLP resourceMetrics structure',
        timestamp: Date.now(),
      });
    }

    const sampleCount = payload.resourceMetrics ? payload.resourceMetrics.length : 1;
    recentTelemetryBuffer.push({
      receivedAtMs: Date.now(),
      source: 'otlp-ingest',
      sampleCount,
      data: payload,
    });
    if (recentTelemetryBuffer.length > MAX_RECENT_BUFFER) {
      recentTelemetryBuffer.shift();
    }

    return res.status(202).json({
      success: true,
      message: 'OTLP payload successfully ingested',
      samplesRecorded: sampleCount,
      timestamp: Date.now(),
    });
  });

  // Secured Telemetry Proxy Route
  // Protects against SSRF, redirects, injects server-held credentials, enforces timeouts and payload limits
  app.post('/api/telemetry/proxy', rateLimiterMiddleware, telemetryAuthGuard, async (req: Request, res: Response) => {
    const { targetUrl, bearerToken: clientToken, headers: customHeaders } = req.body || {};

    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_TARGET_URL',
        error: 'targetUrl string is required',
        timestamp: Date.now(),
      });
    }

    const check = isHostApproved(targetUrl);
    if (!check.approved) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_DESTINATION',
        error: check.error,
        timestamp: Date.now(),
      });
    }

    try {
      const forwardHeaders: Record<string, string> = {
        'Accept': 'application/json',
        ...customHeaders,
      };

      // Server-side credential priority: credentials stay outside browser bundles
      const serverSecret = process.env.TELEMETRY_BEARER_TOKEN || process.env.PROMETHEUS_AUTH_TOKEN;
      const effectiveToken = serverSecret || clientToken;
      if (effectiveToken) {
        forwardHeaders['Authorization'] = effectiveToken.startsWith('Bearer ')
          ? effectiveToken
          : `Bearer ${effectiveToken}`;
      }

      // Enforce strict 5000ms upstream timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Redirect-resistant upstream fetch
      let currentUrl = targetUrl;
      let upstreamResponse: any;
      let redirectCount = 0;
      const MAX_REDIRECTS = 3;

      while (true) {
        upstreamResponse = await fetch(currentUrl, {
          method: 'GET',
          headers: forwardHeaders,
          signal: controller.signal,
          redirect: 'manual',
        });

        // Intercept redirects and re-validate destination against approved hosts
        if ([301, 302, 303, 307, 308].includes(upstreamResponse.status)) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            clearTimeout(timeoutId);
            return res.status(508).json({
              success: false,
              code: 'TOO_MANY_REDIRECTS',
              error: `Upstream redirect limit exceeded (${MAX_REDIRECTS})`,
              timestamp: Date.now(),
            });
          }

          const location = upstreamResponse.headers.get('location');
          if (!location) {
            clearTimeout(timeoutId);
            return res.status(502).json({
              success: false,
              code: 'INVALID_REDIRECT',
              error: 'Redirect response missing Location header',
              timestamp: Date.now(),
            });
          }

          const resolvedRedirect = new URL(location, currentUrl).toString();
          const redirectCheck = isHostApproved(resolvedRedirect);
          if (!redirectCheck.approved) {
            clearTimeout(timeoutId);
            return res.status(403).json({
              success: false,
              code: 'FORBIDDEN_REDIRECT_DESTINATION',
              error: `SSRF Guard: Redirect to unapproved host was blocked. Target: ${resolvedRedirect}. ${redirectCheck.error}`,
              timestamp: Date.now(),
            });
          }
          currentUrl = resolvedRedirect;
          continue;
        }
        break;
      }

      clearTimeout(timeoutId);

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          success: false,
          code: 'UPSTREAM_HTTP_ERROR',
          error: `Upstream collector returned HTTP ${upstreamResponse.status}: ${upstreamResponse.statusText}`,
          timestamp: Date.now(),
        });
      }

      const data = await upstreamResponse.json();

      // Buffer successful telemetry trace
      recentTelemetryBuffer.push({
        receivedAtMs: Date.now(),
        source: targetUrl,
        sampleCount: data?.data?.result?.length || data?.resourceMetrics?.length || 1,
        data,
      });
      if (recentTelemetryBuffer.length > MAX_RECENT_BUFFER) {
        recentTelemetryBuffer.shift();
      }

      return res.status(200).json(data);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          code: 'GATEWAY_TIMEOUT',
          error: 'Telemetry upstream connection timed out after 5000ms',
          timestamp: Date.now(),
        });
      }
      return res.status(502).json({
        success: false,
        code: 'PROXY_FETCH_FAILURE',
        error: 'Failed to proxy telemetry request',
        details: err.message,
        timestamp: Date.now(),
      });
    }
  });

  // Benchmark API endpoint for reproducible deterministic benchmarks
  app.post('/api/benchmarks/run', (req: Request, res: Response) => {
    const { scenarioName, seed, numTrials, horizonMs, benchmarkType, traceData } = req.body || {};

    if (benchmarkType === 'out-of-sample' && Array.isArray(traceData)) {
      const outOfSampleReport = runOutOfSampleTelemetryBenchmark(traceData, {
        seed: seed !== undefined ? parseInt(seed, 10) : 42,
        horizonMs: horizonMs !== undefined ? parseInt(horizonMs, 10) : 500,
      });
      return res.json(outOfSampleReport);
    }

    const report = runDeterministicBenchmark({
      scenarioName,
      seed: seed !== undefined ? parseInt(seed, 10) : 42,
      numTrials: numTrials !== undefined ? parseInt(numTrials, 10) : 15,
      horizonMs: horizonMs !== undefined ? parseInt(horizonMs, 10) : 500,
      benchmarkType: benchmarkType || 'simulated_hrm',
    });
    return res.json(report);
  });

  // FlameScope assistant: evidence-grounded Gemini phrasing.
  // The client retrieves evidence locally and sends ONLY that evidence.
  // Gemini may rephrase it, must cite evidence ids like [E1], and must
  // not introduce facts beyond the supplied evidence. When no key is
  // configured, the endpoint reports mode 'offline' and the client uses
  // its extractive composer. The API key never leaves the server.
  app.post('/api/assistant/ask', rateLimiterMiddleware, async (req: Request, res: Response) => {
    const { question, evidence } = req.body || {};
    if (typeof question !== 'string' || !Array.isArray(evidence) || evidence.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EVIDENCE_REQUIRED',
        error: 'A question string and a non-empty evidence array are required. Ungrounded questions are not answered.',
        timestamp: Date.now(),
      });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({ success: true, mode: 'offline', reason: 'GEMINI_API_KEY not configured on the server.' });
    }
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const evidenceText = evidence
        .slice(0, 12)
        .map((e: { id?: string; text?: string }) => `[${String(e.id || '?')}] ${String(e.text || '').slice(0, 1200)}`)
        .join('\n');
      const prompt = [
        'You are the FlameScope research assistant. Answer the question using ONLY the evidence below.',
        'Cite every empirical claim with its evidence id in square brackets, e.g. [E1].',
        'If the evidence does not support an answer, say so explicitly and name what is missing.',
        'Never invent measurements, equations, citations, or NASA findings. Distinguish hypotheses from conclusions.',
        '',
        `Question: ${question.slice(0, 500)}`,
        '',
        'Evidence:',
        evidenceText,
      ].join('\n');
      const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const text = (result as { text?: string }).text || '';
      if (!text) return res.json({ success: true, mode: 'offline', reason: 'Gemini returned no text.' });
      return res.json({ success: true, mode: 'gemini', text });
    } catch (err: unknown) {
      return res.json({
        success: true,
        mode: 'offline',
        reason: `Gemini request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    }
  });

  // Mock / Sample Prometheus & OTLP endpoints for live testing
  app.get('/api/telemetry/sample/prometheus', (_req: Request, res: Response) => {
    const nowSec = Date.now() / 1000;
    const samplePrometheus = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'ashburn-dc01' }, value: [nowSec, '68.4'] },
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'frankfurt-dc01' }, value: [nowSec, '54.2'] },
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'tokyo-dc01' }, value: [nowSec, '72.1'] },
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'dublin-dc01' }, value: [nowSec, '61.8'] },
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'singapore-dc01' }, value: [nowSec, '76.3'] },
          { metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'saopaulo-dc01' }, value: [nowSec, '49.0'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'ashburn-dc01' }, value: [nowSec, '0.021'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'frankfurt-dc01' }, value: [nowSec, '0.016'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'tokyo-dc01' }, value: [nowSec, '0.028'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'dublin-dc01' }, value: [nowSec, '0.019'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'singapore-dc01' }, value: [nowSec, '0.032'] },
          { metric: { __name__: 'http_request_duration_seconds', instance: 'saopaulo-dc01' }, value: [nowSec, '0.024'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'ashburn-dc01' }, value: [nowSec, '14.2'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'frankfurt-dc01' }, value: [nowSec, '16.1'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'tokyo-dc01' }, value: [nowSec, '18.5'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'dublin-dc01' }, value: [nowSec, '13.8'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'singapore-dc01' }, value: [nowSec, '21.0'] },
          { metric: { __name__: 'node_hwmon_temp_celsius', instance: 'saopaulo-dc01' }, value: [nowSec, '17.3'] },
          { metric: { __name__: 'facility_power_kw', instance: 'ashburn-dc01' }, value: [nowSec, '1.18'] },
          { metric: { __name__: 'facility_power_kw', instance: 'frankfurt-dc01' }, value: [nowSec, '1.14'] },
          { metric: { __name__: 'facility_power_kw', instance: 'tokyo-dc01' }, value: [nowSec, '1.25'] },
        ],
      },
    };
    return res.json(samplePrometheus);
  });

  const httpServer = http.createServer(app);

  // Vite middleware in dev
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HRM 4.1 Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
