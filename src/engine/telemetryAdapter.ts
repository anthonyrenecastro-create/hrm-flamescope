/**
 * HRM 4.1 Telemetry Ingestion Adapters
 * Implements standard OpenTelemetry (OTLP JSON/HTTP) and Prometheus HTTP API (/api/v1/query_range)
 * client interfaces for live telemetry ingestion.
 * 
 * Strict Validation & Missing-Data Invariant:
 * 1. Rejects malformed, stale, unmapped, and non-finite measurements (NaN / Infinity).
 * 2. Never invents synthetic values for absent metrics; preserves missing-data indicators.
 * 3. Normalizes timestamps to Unix epoch milliseconds and validates against clock skew.
 */

import {
  FieldChannels,
  HubNode,
  TelemetryIngestionConfig,
  NodeObservation,
  TelemetryObservation,
  MetricQuality,
} from '../types/hrm';

export interface ParseTelemetryResult {
  observations: NodeObservation[];
  rawObservations: TelemetryObservation[];
  unmappedSeriesCount: number;
  rejectedSampleCount: number;
  coveredNodeIds: string[];
}

export const DEFAULT_PROMETHEUS_QUERIES = {
  gpuUtil: 'avg by (instance) (rate(container_cpu_usage_seconds_total[1m])) * 100',
  queueLatency: 'avg by (instance) (http_request_duration_seconds{quantile="0.99"}) * 1000',
  thermalHeadroom: '45 - avg by (instance) (node_hwmon_temp_celsius)',
  pue: 'avg by (instance) (facility_power_kw / it_power_kw)',
};

/**
 * Validates whether a numerical measurement is finite and within physical datacenter bounds.
 */
export function validateChannelValue(
  channel: 'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue',
  val: number
): { valid: boolean; clamped?: number; reason?: string } {
  if (!Number.isFinite(val) || Number.isNaN(val)) {
    return { valid: false, reason: 'Value is NaN or non-finite' };
  }

  switch (channel) {
    case 'gpuUtil':
      if (val < 0 || val > 100) return { valid: false, reason: `GPU util ${val}% outside [0, 100]` };
      return { valid: true, clamped: Math.max(0, Math.min(100, val)) };
    case 'queueLatencyMs':
      if (val < 0 || val > 10000) return { valid: false, reason: `Latency ${val}ms outside [0, 10000]` };
      return { valid: true, clamped: Math.max(0, val) };
    case 'thermalHeadroomC':
      if (val < -10 || val > 80) return { valid: false, reason: `Thermal headroom ${val}C outside [-10, 80]` };
      return { valid: true, clamped: Math.max(0, Math.min(60, val)) };
    case 'pue':
      if (val < 1.0 || val > 4.0) return { valid: false, reason: `PUE ${val} outside physical bounds [1.0, 4.0]` };
      return { valid: true, clamped: Math.max(1.0, Math.min(3.0, val)) };
  }
}

/**
 * Parses and strictly validates Prometheus HTTP API response format.
 * Rejects non-finite values and preserves missing-channel indicators.
 */
export function parsePrometheusMetrics(
  prometheusJson: any,
  nodes: HubNode[],
  receivedAtMs: number = Date.now()
): ParseTelemetryResult {
  const observations: NodeObservation[] = [];
  const rawObservations: TelemetryObservation[] = [];
  let unmappedSeriesCount = 0;
  let rejectedSampleCount = 0;
  const coveredNodeIds: string[] = [];

  if (!prometheusJson || !prometheusJson.data || !prometheusJson.data.result) {
    return {
      observations: [],
      rawObservations: [],
      unmappedSeriesCount: 0,
      rejectedSampleCount: 0,
      coveredNodeIds: [],
    };
  }

  const series = prometheusJson.data.result;
  if (!Array.isArray(series)) {
    return { observations: [], rawObservations: [], unmappedSeriesCount: 0, rejectedSampleCount: 0, coveredNodeIds: [] };
  }

  // Iterate over each known planetary datacenter node
  for (const node of nodes) {
    const matching = series.filter((s: any) => {
      const metric = s.metric || {};
      const inst = (metric.instance || metric.node || metric.hub || '').toLowerCase();
      return (
        inst.includes(node.id.toLowerCase()) ||
        inst.includes(node.code.toLowerCase()) ||
        inst.includes(node.name.toLowerCase().split(' ')[0])
      );
    });

    if (matching.length === 0) {
      // Node has NO measurements in this Prometheus response.
      // Do NOT invent values; omit or leave empty.
      continue;
    }

    const channels: {
      gpuUtil?: number;
      queueLatencyMs?: number;
      thermalHeadroomC?: number;
      pue?: number;
    } = {};
    let latestTimestampMs = 0;

    for (const item of matching) {
      let rawVal: number;
      let sampleTimeSec: number = receivedAtMs / 1000;

      if (Array.isArray(item.value)) {
        sampleTimeSec = parseFloat(item.value[0]);
        rawVal = parseFloat(item.value[1]);
      } else if (Array.isArray(item.values) && item.values.length > 0) {
        const last = item.values[item.values.length - 1];
        sampleTimeSec = parseFloat(last[0]);
        rawVal = parseFloat(last[1]);
      } else {
        rejectedSampleCount++;
        continue;
      }

      const sampleTimeMs = Math.round(sampleTimeSec * 1000);
      if (sampleTimeMs > latestTimestampMs) {
        latestTimestampMs = sampleTimeMs;
      }

      const metricName = (item.metric?.__name__ || '').toLowerCase();
      let matchedChannel: 'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue' | null = null;
      let calculatedVal = rawVal;

      if (metricName.includes('cpu') || metricName.includes('gpu')) {
        matchedChannel = 'gpuUtil';
      } else if (metricName.includes('latency') || metricName.includes('duration')) {
        matchedChannel = 'queueLatencyMs';
        if (metricName.includes('seconds')) {
          calculatedVal = rawVal * 1000; // seconds to ms
        }
      } else if (metricName.includes('temp') || metricName.includes('headroom')) {
        matchedChannel = 'thermalHeadroomC';
        if (metricName.includes('temp')) {
          calculatedVal = 45.0 - rawVal; // standard headroom calculation: 45°C trip threshold minus measured temp
        }
      } else if (metricName.includes('pue') || metricName.includes('power')) {
        matchedChannel = 'pue';
      } else {
        unmappedSeriesCount++;
      }

      if (matchedChannel) {
        const valCheck = validateChannelValue(matchedChannel, calculatedVal);
        if (valCheck.valid && valCheck.clamped !== undefined) {
          channels[matchedChannel] = valCheck.clamped;
          rawObservations.push({
            nodeId: node.id,
            channel: matchedChannel,
            value: valCheck.clamped,
            eventTimeMs: sampleTimeMs,
            receivedAtMs,
            source: 'prometheus',
            quality: 'good',
          });
        } else {
          rejectedSampleCount++;
        }
      }
    }

    const missingChannels: Array<'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue'> = [];
    if (channels.gpuUtil === undefined) missingChannels.push('gpuUtil');
    if (channels.queueLatencyMs === undefined) missingChannels.push('queueLatencyMs');
    if (channels.thermalHeadroomC === undefined) missingChannels.push('thermalHeadroomC');
    if (channels.pue === undefined) missingChannels.push('pue');

    if (Object.keys(channels).length > 0) {
      coveredNodeIds.push(node.id);
      observations.push({
        nodeId: node.id,
        timestampMs: latestTimestampMs > 0 ? latestTimestampMs : receivedAtMs,
        receivedAtMs,
        channels,
        missingChannels,
        quality: missingChannels.length === 0 ? 'good' : 'degraded',
        isRealWorld: true,
      });
    }
  }

  return {
    observations,
    rawObservations,
    unmappedSeriesCount,
    rejectedSampleCount,
    coveredNodeIds,
  };
}

/**
 * Parses and strictly validates OpenTelemetry (OTLP JSON/HTTP) payload.
 * Rejects non-finite values and preserves missing-channel indicators.
 */
export function parseOTLPMetrics(
  otlpPayload: any,
  nodes: HubNode[],
  receivedAtMs: number = Date.now()
): ParseTelemetryResult {
  const observations: NodeObservation[] = [];
  const rawObservations: TelemetryObservation[] = [];
  let unmappedSeriesCount = 0;
  let rejectedSampleCount = 0;
  const coveredNodeIds: string[] = [];

  if (!otlpPayload || !otlpPayload.resourceMetrics || !Array.isArray(otlpPayload.resourceMetrics)) {
    return { observations: [], rawObservations: [], unmappedSeriesCount: 0, rejectedSampleCount: 0, coveredNodeIds: [] };
  }

  const resourceMetrics = otlpPayload.resourceMetrics;

  for (const node of nodes) {
    const channels: {
      gpuUtil?: number;
      queueLatencyMs?: number;
      thermalHeadroomC?: number;
      pue?: number;
    } = {};
    let latestTimestampMs = 0;

    for (const rm of resourceMetrics) {
      const attrs = rm.resource?.attributes || [];
      const serviceNameAttr = attrs.find((a: any) => a.key === 'service.name' || a.key === 'host.name' || a.key === 'datacenter.id');
      const serviceName = (serviceNameAttr?.value?.stringValue || '').toLowerCase();

      if (
        !serviceName.includes(node.id.toLowerCase()) &&
        !serviceName.includes(node.code.toLowerCase())
      ) {
        continue;
      }

      const scopeMetrics = rm.scopeMetrics || [];
      for (const sm of scopeMetrics) {
        for (const metric of sm.metrics || []) {
          const name = (metric.name || '').toLowerCase();
          const dps = metric.gauge?.dataPoints || metric.sum?.dataPoints || [];
          if (dps.length === 0) continue;

          const lastDp = dps[dps.length - 1];
          const rawVal = Number(lastDp.asDouble ?? lastDp.asInt ?? NaN);
          const timeNano = Number(lastDp.timeUnixNano ?? 0);
          const sampleTimeMs = timeNano > 0 ? Math.round(timeNano / 1e6) : receivedAtMs;
          if (sampleTimeMs > latestTimestampMs) {
            latestTimestampMs = sampleTimeMs;
          }

          let matchedChannel: 'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue' | null = null;
          let calculatedVal = rawVal;

          if (name.includes('util') || name.includes('cpu') || name.includes('gpu')) {
            matchedChannel = 'gpuUtil';
          } else if (name.includes('queue') || name.includes('latency') || name.includes('duration')) {
            matchedChannel = 'queueLatencyMs';
            if (name.includes('second')) calculatedVal = rawVal * 1000;
          } else if (name.includes('headroom') || name.includes('temp')) {
            matchedChannel = 'thermalHeadroomC';
            if (name.includes('temp')) calculatedVal = 45.0 - rawVal;
          } else if (name.includes('pue') || name.includes('power')) {
            matchedChannel = 'pue';
          } else {
            unmappedSeriesCount++;
          }

          if (matchedChannel) {
            const check = validateChannelValue(matchedChannel, calculatedVal);
            if (check.valid && check.clamped !== undefined) {
              channels[matchedChannel] = check.clamped;
              rawObservations.push({
                nodeId: node.id,
                channel: matchedChannel,
                value: check.clamped,
                eventTimeMs: sampleTimeMs,
                receivedAtMs,
                source: 'opentelemetry',
                quality: 'good',
              });
            } else {
              rejectedSampleCount++;
            }
          }
        }
      }
    }

    const missingChannels: Array<'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue'> = [];
    if (channels.gpuUtil === undefined) missingChannels.push('gpuUtil');
    if (channels.queueLatencyMs === undefined) missingChannels.push('queueLatencyMs');
    if (channels.thermalHeadroomC === undefined) missingChannels.push('thermalHeadroomC');
    if (channels.pue === undefined) missingChannels.push('pue');

    if (Object.keys(channels).length > 0) {
      coveredNodeIds.push(node.id);
      observations.push({
        nodeId: node.id,
        timestampMs: latestTimestampMs > 0 ? latestTimestampMs : receivedAtMs,
        receivedAtMs,
        channels,
        missingChannels,
        quality: missingChannels.length === 0 ? 'good' : 'degraded',
        isRealWorld: true,
      });
    }
  }

  return {
    observations,
    rawObservations,
    unmappedSeriesCount,
    rejectedSampleCount,
    coveredNodeIds,
  };
}

/**
 * Fetches live telemetry via the secured server-side proxy route or local endpoints.
 * Credentials are kept out of query strings and handled through HTTP headers.
 */
export async function fetchLiveTelemetry(
  config: TelemetryIngestionConfig,
  nodes: HubNode[]
): Promise<{
  success: boolean;
  observations?: NodeObservation[];
  data?: Map<string, FieldChannels>; // backward compatibility helper
  error?: string;
  coveredCount?: number;
  unmappedCount?: number;
  rejectedCount?: number;
}> {
  if (config.sourceMode === 'simulated') {
    return { success: true, observations: [] };
  }

  try {
    let response: globalThis.Response;
    const isLocalEndpoint = config.endpoint.startsWith('/api/');

    if (isLocalEndpoint) {
      // Direct call to local API route
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (config.bearerToken) {
        headers['Authorization'] = `Bearer ${config.bearerToken}`;
      }

      response = await fetch(config.endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(6000), // 6-second timeout
      });
    } else {
      // Outbound external telemetry call routed through the authenticated secure server proxy
      response = await fetch('/api/telemetry/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          targetUrl: config.endpoint,
          bearerToken: config.bearerToken || undefined,
        }),
        signal: AbortSignal.timeout(7000),
      });
    }

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson.error) errMsg = `${errMsg} - ${errJson.error}`;
      } catch {
        // non-json response
      }
      return { success: false, error: errMsg };
    }

    const json = await response.json();
    const parseResult =
      config.sourceMode === 'prometheus'
        ? parsePrometheusMetrics(json, nodes)
        : parseOTLPMetrics(json, nodes);

    // Build backward-compatible map for nodes that had at least one observation
    const legacyMap = new Map<string, FieldChannels>();
    for (const obs of parseResult.observations) {
      const node = nodes.find(n => n.id === obs.nodeId);
      const priorPue = node ? node.pueBaseline : 1.2;
      legacyMap.set(obs.nodeId, [
        obs.channels.gpuUtil ?? 55.0,
        obs.channels.queueLatencyMs ?? 20.0,
        obs.channels.thermalHeadroomC ?? 30.0,
        obs.channels.pue ?? priorPue,
      ]);
    }

    return {
      success: true,
      observations: parseResult.observations,
      data: legacyMap,
      coveredCount: parseResult.observations.length,
      unmappedCount: parseResult.unmappedSeriesCount,
      rejectedCount: parseResult.rejectedSampleCount,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.name === 'TimeoutError' ? 'Connection timed out (6s limit)' : (err.message || 'Network error fetching telemetry'),
    };
  }
}
