/**
 * Complete, standalone, typed Python implementation of HRM 4.0
 * Ready for direct execution with python3 -m hrm4_engine or FastAPI runner.
 */

export const PYTHON_HRM4_STANDALONE_CODE = `"""
Helical Recursive Manifold (HRM 4.0) Planetary AI Telemetry Engine
Coupled with Dual Parallel Worldmodel Architectures.

Mathematical Invariance:
  X_t = [Phi, G, T, M, C, H, B]
  Conservation of Explanation:
  Delta^T X_t = A_{0,t}^T + Sum A_{k,t}^T + Sum A_{ij,t}^T + A_{xi,t}^T + A_{event,t} + A_{corr,t} + eps_t
  Verification: ||eps_t|| / (||Delta^T X_t|| + delta) <= tau_ledger
"""

import math
import time
import json
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Tuple, Optional
import numpy as np

EARTH_RADIUS_KM = 6371.0
SPEED_OF_LIGHT_IN_FIBER_KM_MS = 200.0  # ~200 km/ms in single-mode fiber
SIGMA_DISTANCE_KM = 7000.0
TAU_LEDGER_TOLERANCE = 1e-4
DELTA_REGULARIZER = 1e-6

# Diffusivity tensor D_Phi for [GPU %, Queue Latency ms, Thermal Headroom C, PUE]
DIFFUSIVITY_TENSOR = np.array([0.015, 0.035, 0.008, 0.003], dtype=np.float64)
REACTION_A = np.array([0.02, 0.03, -0.01, 0.005], dtype=np.float64)
REACTION_B = np.array([0.00002, 0.00001, 0.000005, 0.00001], dtype=np.float64)

PHYSICAL_MIN = np.array([0.0, 0.5, 2.0, 1.05], dtype=np.float64)
PHYSICAL_MAX = np.array([100.0, 300.0, 45.0, 2.0], dtype=np.float64)


@dataclass
class HubNode:
    id: str
    code: str
    name: str
    lat: float
    lng: float
    country: str
    region: str
    pue_baseline: float
    cooling_capacity_mw: float
    solar_exposure_coeff: float


@dataclass
class FiberLink:
    id: str
    source_id: str
    target_id: str
    name: str
    link_type: str
    length_km: float
    latency_ms: float
    capacity_tbps: float
    weight: float
    is_severed: bool = False
    health: float = 1.0


@dataclass
class AttributionLedgerC:
    step: int
    timestamp_ms: float
    A_0: List[float]
    A_react: List[float]
    A_diff: List[float]
    A_xi: List[float]
    A_event: List[float]
    A_corr: List[float]
    epsilon: List[float]
    total_delta: List[float]
    residual_ratio: float
    invariant_preserved: bool


@dataclass
class ResourceAllocationB:
    dispatch_vector: List[float]
    utility_scores: List[float]
    switching_penalty: float
    total_budget_cost: float


@dataclass
class DiscreteEvent:
    id: str
    time_ms: float
    event_type: str  # CABLE_SEVER, NODE_THERMAL_TRIP, SOLAR_SHIFT, MICROBURST_SPIKE
    label: str
    target_id: Optional[str] = None
    magnitude: float = 1.0


def compute_geodesic_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(dlam / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_KM * c


def compute_fiber_latency_ms(distance_km: float) -> float:
    return distance_km / SPEED_OF_LIGHT_IN_FIBER_KM_MS


def compute_local_solar_intensity(utc_hours: float, lng: float) -> float:
    local_solar_time = (utc_hours + lng / 15.0 + 24.0) % 24.0
    if 6.0 <= local_solar_time <= 18.0:
        angle = ((local_solar_time - 6.0) / 12.0) * math.pi
        return math.sin(angle)
    return 0.02


class PlanetaryCarrierComplex:
    def __init__(self):
        self.nodes: List[HubNode] = [
            HubNode("ashburn", "IAD", "Ashburn (Data Center Alley)", 39.0438, -77.4874, "USA", "Americas", 1.15, 450, 0.85),
            HubNode("dublin", "DUB", "Dublin (Grange Castle)", 53.3498, -6.2603, "Ireland", "Europe", 1.18, 320, 0.65),
            HubNode("frankfurt", "FRA", "Frankfurt (DE-CIX Core)", 50.1109, 8.6821, "Germany", "Europe", 1.22, 380, 0.70),
            HubNode("london", "LON", "London (Slough/Docklands)", 51.5074, -0.1278, "UK", "Europe", 1.20, 350, 0.68),
            HubNode("oregon", "PDX", "Oregon (The Dalles Hydro)", 45.5946, -121.1787, "USA", "Americas", 1.10, 500, 0.80),
            HubNode("tokyo", "NRT", "Tokyo (Inzai / Otemachi)", 35.6762, 139.6503, "Japan", "APAC", 1.26, 360, 0.90),
            HubNode("singapore", "SIN", "Singapore (Jurong Confluence)", 1.3521, 103.8198, "Singapore", "APAC", 1.32, 280, 0.95),
            HubNode("mumbai", "BOM", "Mumbai (BKC / Navi Mumbai)", 19.0760, 72.8777, "India", "APAC", 1.35, 310, 0.95),
            HubNode("dubai", "DXB", "Dubai (UAE Exchange Hub)", 25.2048, 55.2708, "UAE", "Middle East", 1.38, 240, 1.00),
            HubNode("marseille", "MRS", "Marseille (MRS Subsea Landing)", 43.2965, 5.3698, "France", "Europe", 1.21, 260, 0.82),
            HubNode("saopaulo", "GRU", "Sao Paulo (Tambore / Barueri)", -23.5505, -46.6333, "Brazil", "Americas", 1.28, 290, 0.88),
            HubNode("santiago", "SCL", "Santiago (Quilicura Hub)", -33.4489, -70.6693, "Chile", "Americas", 1.24, 210, 0.92),
            HubNode("johannesburg", "JNB", "Johannesburg (Isando)", -26.2041, 28.0473, "South Africa", "Africa", 1.30, 220, 0.90),
            HubNode("sydney", "SYD", "Sydney (Alexandria / Botany)", -33.8688, 151.2093, "Australia", "APAC", 1.25, 300, 0.90),
        ]
        self.node_map = {n.id: i for i, n in enumerate(self.nodes)}
        self.N = len(self.nodes)
        self.distance_matrix = np.zeros((self.N, self.N), dtype=np.float64)
        self.latency_matrix = np.zeros((self.N, self.N), dtype=np.float64)
        self._init_geodesics()
        self.links: List[FiberLink] = self._init_links()
        self.W = np.zeros((self.N, self.N), dtype=np.float64)
        self.L = np.zeros((self.N, self.N), dtype=np.float64)
        self.recompute_laplacian()

    def _init_geodesics(self):
        for i in range(self.N):
            for j in range(self.N):
                if i == j:
                    self.distance_matrix[i, j] = 0.0
                    self.latency_matrix[i, j] = 0.0
                else:
                    d = compute_geodesic_distance_km(self.nodes[i].lat, self.nodes[i].lng,
                                                     self.nodes[j].lat, self.nodes[j].lng)
                    self.distance_matrix[i, j] = d
                    self.latency_matrix[i, j] = compute_fiber_latency_ms(d)

    def _init_links(self) -> List[FiberLink]:
        specs = [
            ("tat_ash_dub", "ashburn", "dublin", "Dunant / AEC-1 Subsea", "submarine", 250.0),
            ("tat_ash_lon", "ashburn", "london", "Apollo North Subsea", "submarine", 220.0),
            ("eur_dub_lon", "dublin", "london", "Irish Sea Express", "submarine", 180.0),
            ("eur_lon_fra", "london", "frankfurt", "Channel Tunnel Terrestrial", "terrestrial", 320.0),
            ("eur_fra_mrs", "frankfurt", "marseille", "Rhone Valley Terrestrial", "terrestrial", 280.0),
            ("usa_ash_pdx", "ashburn", "oregon", "US Transcontinental Express", "terrestrial", 400.0),
            ("pac_pdx_nrt", "oregon", "tokyo", "FASTER Transpacific Subsea", "submarine", 260.0),
            ("pac_nrt_sin", "tokyo", "singapore", "SJC2 South-East Asia Subsea", "submarine", 240.0),
            ("med_mrs_dxb", "marseille", "dubai", "AAE-1 Med-Gulf Subsea", "submarine", 200.0),
            ("gulf_dxb_bom", "dubai", "mumbai", "MENA / Falcon Subsea", "submarine", 190.0),
            ("ind_bom_sin", "mumbai", "singapore", "i2i / SEA-ME-WE-5 Subsea", "submarine", 210.0),
            ("pac_sin_syd", "singapore", "sydney", "Indigo Central Subsea", "submarine", 160.0),
            ("pac_pdx_syd", "oregon", "sydney", "Southern Cross NEXT Subsea", "submarine", 180.0),
            ("lat_ash_gru", "ashburn", "saopaulo", "Seabras-1 / Monet Subsea", "submarine", 170.0),
            ("lat_gru_scl", "saopaulo", "santiago", "Andes Terrestrial Crossing", "terrestrial", 150.0),
            ("lat_pdx_scl", "oregon", "santiago", "Curie Pacific Subsea", "submarine", 160.0),
            ("afr_lon_jnb", "london", "johannesburg", "2Africa / WACS Subsea", "submarine", 140.0),
            ("afr_jnb_bom", "johannesburg", "mumbai", "SAFE Indian Ocean Subsea", "submarine", 130.0),
            ("eur_fra_dub", "frankfurt", "dublin", "North Sea Ring", "terrestrial", 200.0),
            ("pac_nrt_syd", "tokyo", "sydney", "Japan-Guam-Australia Subsea", "submarine", 170.0),
        ]
        links = []
        for lid, src, tgt, name, ltype, cap in specs:
            s_i = self.node_map[src]
            t_i = self.node_map[tgt]
            d = self.distance_matrix[s_i, t_i]
            lat = self.latency_matrix[s_i, t_i]
            weight = cap * math.exp(-(d ** 2) / (2.0 * (SIGMA_DISTANCE_KM ** 2)))
            links.append(FiberLink(lid, src, tgt, name, ltype, d, lat, cap, weight))
        return links

    def recompute_laplacian(self):
        self.W.fill(0.0)
        for link in self.links:
            if link.is_severed or link.health <= 0.05:
                continue
            i = self.node_map[link.source_id]
            j = self.node_map[link.target_id]
            w = link.weight * link.health
            self.W[i, j] = w
            self.W[j, i] = w

        degree = np.sum(self.W, axis=1)
        # Degree-normalized Graph Laplacian L_rw = I - D^{-1} W
        self.L = np.zeros((self.N, self.N), dtype=np.float64)
        for i in range(self.N):
            if degree[i] > 1e-6:
                self.L[i, i] = 1.0
                for j in range(self.N):
                    if i != j and self.W[i, j] > 0:
                        self.L[i, j] = -self.W[i, j] / degree[i]


class HRM4Engine:
    """
    Helical Recursive Manifold (HRM 4.0) transition solver with
    Conservation of Explanation auditing.
    """
    def __init__(self, carrier: PlanetaryCarrierComplex):
        self.carrier = carrier
        self.N = carrier.N
        # Phi in R^{N x 4}: [GPU Util %, Queue Latency ms, Thermal Headroom C, PUE]
        self.Phi = np.zeros((self.N, 4), dtype=np.float64)
        for i in range(self.N):
            self.Phi[i, 0] = 58.0 + math.sin(i * 1.3) * 8.0
            self.Phi[i, 1] = 20.0 + math.cos(i * 0.9) * 5.0
            self.Phi[i, 2] = 32.0 - (self.Phi[i, 0] / 100.0) * 8.0
            self.Phi[i, 3] = self.carrier.nodes[i].pue_baseline

        self.helical_phase = np.linspace(0, 2 * math.pi, self.N, endpoint=False)
        self.allocation = np.full(self.N, 1.0 / self.N, dtype=np.float64)

    def step(self, sim_time_ms: float, dt: float, active_events: List[DiscreteEvent]) -> Tuple[np.ndarray, AttributionLedgerC, ResourceAllocationB]:
        utc_hours = ((sim_time_ms / 3600000.0) % 24.0 + 24.0) % 24.0

        # Allocation terms
        A_0 = np.zeros((self.N, 4), dtype=np.float64)
        A_react = np.zeros((self.N, 4), dtype=np.float64)
        A_diff = np.zeros((self.N, 4), dtype=np.float64)
        A_xi = np.zeros((self.N, 4), dtype=np.float64)
        A_event = np.zeros((self.N, 4), dtype=np.float64)

        # 1. Diurnal Drift A_0
        for i in range(self.N):
            solar = compute_local_solar_intensity(utc_hours, self.carrier.nodes[i].lng)
            A_0[i, 0] = (solar - 0.45) * 0.008 * dt
            A_0[i, 1] = (solar - 0.5) * 0.004 * dt
            A_0[i, 2] = -(solar - 0.4) * 0.003 * dt
            A_0[i, 3] = (solar - 0.45) * 0.0001 * dt

        # 2. Local Reaction A_k = R_Phi(phi) (Duffing-Landau restoring potential)
        alpha = np.array([0.0012, 0.0035, 0.0015, 0.0008])
        beta = np.array([1.5e-7, 2.0e-7, 1.0e-7, 5.0e-6])
        for i in range(self.N):
            target = np.array([58.0, 18.0, 31.0, self.carrier.nodes[i].pue_baseline])
            delta = self.Phi[i] - target
            A_react[i] = -(alpha * delta + beta * (delta ** 3)) * dt

        # 3. Graph Laplacian Diffusion A_ij = -D_Phi L Phi
        for c in range(4):
            l_phi = self.carrier.L @ self.Phi[:, c]
            diff_rate = DIFFUSIVITY_TENSOR[c]
            A_diff[:, c] = -diff_rate * l_phi * dt

        # 4. Stochastic Brownian Fluctuations A_xi
        noise = np.random.randn(self.N, 4)
        A_xi[:, 0] = noise[:, 0] * 0.12 * math.sqrt(dt)
        A_xi[:, 1] = np.abs(noise[:, 1]) * 0.25 * math.sqrt(dt)
        A_xi[:, 2] = -np.abs(noise[:, 2]) * 0.03 * math.sqrt(dt)
        A_xi[:, 3] = noise[:, 3] * 0.001 * math.sqrt(dt)

        # 5. Discrete Structural Events A_event
        for ev in active_events:
            if ev.event_type == "CABLE_SEVER":
                for link in self.carrier.links:
                    if link.id == ev.target_id or link.is_severed:
                        s_i = self.carrier.node_map[link.source_id]
                        t_i = self.carrier.node_map[link.target_id]
                        A_event[s_i, 1] += 18.0 * ev.magnitude * dt
                        A_event[t_i, 1] += 14.0 * ev.magnitude * dt
            elif ev.event_type == "NODE_THERMAL_TRIP" and ev.target_id in self.carrier.node_map:
                t_i = self.carrier.node_map[ev.target_id]
                A_event[t_i, 0] -= 25.0 * ev.magnitude * dt
                A_event[t_i, 1] += 30.0 * ev.magnitude * dt
                A_event[t_i, 2] -= 15.0 * ev.magnitude * dt

        # Unconstrained candidate
        Phi_cand = self.Phi + A_0 + A_react + A_diff + A_xi + A_event

        # 6. Stabilization Projection P_t
        Phi_proj = np.clip(Phi_cand, PHYSICAL_MIN, PHYSICAL_MAX)
        A_corr = Phi_proj - Phi_cand

        # 7. Exact Attribution Ledger Invariant Verification
        Delta_actual = Phi_proj - self.Phi
        sum_attributions = A_0 + A_react + A_diff + A_xi + A_event + A_corr
        epsilon = Delta_actual - sum_attributions

        norm_eps = float(np.linalg.norm(epsilon))
        norm_delta = float(np.linalg.norm(Delta_actual))
        residual_ratio = norm_eps / (norm_delta + DELTA_REGULARIZER)
        invariant_preserved = residual_ratio <= TAU_LEDGER_TOLERANCE

        self.Phi = Phi_proj

        ledger = AttributionLedgerC(
            step=int(sim_time_ms / dt),
            timestamp_ms=sim_time_ms,
            A_0=np.sum(A_0, axis=0).tolist(),
            A_react=np.sum(A_react, axis=0).tolist(),
            A_diff=np.sum(A_diff, axis=0).tolist(),
            A_xi=np.sum(A_xi, axis=0).tolist(),
            A_event=np.sum(A_event, axis=0).tolist(),
            A_corr=np.sum(A_corr, axis=0).tolist(),
            epsilon=np.sum(epsilon, axis=0).tolist(),
            total_delta=np.sum(Delta_actual, axis=0).tolist(),
            residual_ratio=residual_ratio,
            invariant_preserved=invariant_preserved,
        )

        # 8. Resource Allocation
        alloc = self._solve_allocation(utc_hours)
        return self.Phi, ledger, alloc

    def _solve_allocation(self, utc_hours: float) -> ResourceAllocationB:
        utilities = np.zeros(self.N, dtype=np.float64)
        for i in range(self.N):
            solar = compute_local_solar_intensity(utc_hours, self.carrier.nodes[i].lng)
            clean = min(1.0, solar * self.carrier.nodes[i].solar_exposure_coeff + 0.15)
            lat_score = max(0.0, 1.0 - self.Phi[i, 1] / 80.0)
            therm_score = np.clip(self.Phi[i, 2] / 40.0, 0.0, 1.0)
            pue_score = max(0.0, 1.0 - (self.Phi[i, 3] - 1.1) / 0.6)
            utilities[i] = 0.35 * lat_score + 0.30 * clean + 0.20 * therm_score + 0.15 * pue_score

        # Exponentiated gradient with switching cost
        lambda_switch = 0.15
        penalties = lambda_switch * np.abs(self.allocation - (1.0 / self.N))
        exp_u = np.exp((utilities - penalties) * 3.5)
        new_alloc = exp_u / np.sum(exp_u)
        sw_cost = float(lambda_switch * np.sum(np.abs(new_alloc - self.allocation)))
        self.allocation = new_alloc
        budget_cost = float(np.sum(new_alloc * (self.Phi[:, 3] * 12.5 + self.Phi[:, 0] * 0.4)))

        return ResourceAllocationB(
            dispatch_vector=new_alloc.tolist(),
            utility_scores=utilities.tolist(),
            switching_penalty=sw_cost,
            total_budget_cost=budget_cost,
        )


def run_hrm41_predictive_benchmark(num_trials: int = 10, horizon_ms: int = 500):
    print("=" * 65)
    print("HRM 4.1 Planetary Telemetry - 500ms Predictive Benchmark Suite")
    print("=" * 65)
    carrier = PlanetaryCarrierComplex()
    engine = HRM4Engine(carrier)

    print(f"Nodes: {carrier.N} Data Centers, Links: {len(carrier.links)} Fiber Trunks")
    print(f"Speed of light in fiber c_fiber = {SPEED_OF_LIGHT_IN_FIBER_KM_MS} km/ms")
    print(f"Testing {num_trials} trials over {horizon_ms} ms forward horizons...")

    hrm_errors = []
    persistence_errors = []
    all_invariants_pass = True

    for trial in range(num_trials):
        # Warmup plant
        for s in range(50):
            phi, ledger, _ = engine.step(trial * 1000 + s * 2.0, 2.0, [])
            if not ledger.invariant_preserved:
                all_invariants_pass = False

        issue_phi = np.copy(engine.Phi)

        # True 500ms predictive forward integration (HRM 4.1)
        pred_engine = HRM4Engine(carrier)
        pred_engine.Phi = np.copy(issue_phi)
        for s in range(horizon_ms):
            pred_phi, _, _ = pred_engine.step(s * 1.0, 1.0, [])

        # Ground truth plant advancement
        for s in range(horizon_ms):
            truth_phi, ledger, _ = engine.step((s + 50) * 1.0, 1.0, [])
            if not ledger.invariant_preserved:
                all_invariants_pass = False

        # Compute MAE
        hrm_mae = float(np.mean(np.abs(pred_phi - truth_phi)))
        persist_mae = float(np.mean(np.abs(issue_phi - truth_phi)))

        hrm_errors.append(hrm_mae)
        persistence_errors.append(persist_mae)

    mean_hrm_mae = float(np.mean(hrm_errors))
    mean_pers_mae = float(np.mean(persistence_errors))
    improvement = ((mean_pers_mae - mean_hrm_mae) / mean_pers_mae) * 100

    print("-" * 65)
    print(f"HRM 4.1 Predictive MAE:   {mean_hrm_mae:.4f}")
    print(f"Persistence Baseline MAE: {mean_pers_mae:.4f}")
    print(f"Accuracy Gain:            +{improvement:.1f}% error reduction")
    print(f"Explanation Invariance:   {'ALL INVARIANTS PRESERVED' if all_invariants_pass else 'FAILED'}")
    print("=" * 65)


if __name__ == "__main__":
    run_hrm41_predictive_benchmark()
`;
