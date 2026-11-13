"""Build reproducible, offline cycle and feature clustering from observed data.

Run: python3 Code/analysis/clustering.py --self-test
Requires the existing NumPy/SciPy dependencies, with no source-data changes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy.cluster.hierarchy import cut_tree, leaves_list, linkage
from scipy.spatial.distance import pdist, squareform
from scipy.stats import rankdata, spearmanr

from scatterplots import FEATURES, INPUT, load_rows

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
RESULTS = REPO / "Reports"
WEB = REPO / "Web" / "HTML"
FEATURE_KEYS = [f[0] for f in FEATURES]
VARIANTS = {"all": FEATURE_KEYS, "without_interval": FEATURE_KEYS[:-1]}
KS = range(2, 7)


def silhouette(distances: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Euclidean silhouette per cycle; singleton clusters have silhouette zero."""
    result = np.zeros(len(labels))
    groups = [np.flatnonzero(labels == label) for label in np.unique(labels)]
    for members in groups:
        if len(members) == 1:
            continue
        a = distances[np.ix_(members, members)].sum(axis=1) / (len(members) - 1)
        b = np.min([distances[np.ix_(members, other)].mean(axis=1)
                    for other in groups if other is not members], axis=0)
        result[members] = np.divide(b - a, np.maximum(a, b),
                                    out=np.zeros_like(a), where=np.maximum(a, b) > 0)
    return result


def ordered_labels(labels: np.ndarray, scores: np.ndarray) -> np.ndarray:
    """Name groups by their feature-only PC1 position, never by the SoH label."""
    order = sorted(np.unique(labels), key=lambda c: float(scores[labels == c, 0].mean()))
    mapping = {int(c): i for i, c in enumerate(order)}
    return np.array([mapping[int(c)] for c in labels])


def analyze(rows: list[dict], battery: str, feature_keys: list[str]) -> dict:
    selected = [i for i, row in enumerate(rows)
                if battery == "ALL" or row["battery_id"] == battery]
    indices = [i for i in selected if all(rows[i][f] is not None for f in feature_keys)]
    if len(indices) <= max(KS):
        raise ValueError(f"{battery}: too few complete cycles for 2–6 clusters")
    raw = np.array([[rows[i][f] for f in feature_keys] for i in indices])
    mean, scale = raw.mean(axis=0), raw.std(axis=0, ddof=0)
    if not np.all(scale > 0):
        raise ValueError(f"{battery}: a constant feature cannot be standardized")
    z = (raw - mean) / scale
    u, singular, components = np.linalg.svd(z, full_matrices=False)
    # Fix SVD sign ambiguity using feature loadings, so labels stay interpretable.
    for component in range(len(components)):
        largest = np.argmax(np.abs(components[component]))
        if components[component, largest] < 0:
            components[component] *= -1
            u[:, component] *= -1
    scores = u[:, :2] * singular[:2]
    variance = singular ** 2 / (singular @ singular)
    distances = squareform(pdist(z, metric="euclidean"))
    tree = linkage(z, method="ward", optimal_ordering=True)
    cuts = {}
    for k in KS:
        labels = ordered_labels(cut_tree(tree, n_clusters=k).ravel(), scores)
        values = silhouette(distances, labels)
        groups = []
        for c in range(k):
            mask = labels == c
            members = [rows[i] for i, keep in zip(indices, mask) if keep]
            soh = np.array([r["soh"] for r in members])
            cycles = [r["cycle"] for r in members]
            groups.append({
                "cluster": c, "n": len(members),
                "soh_mean": float(soh.mean()),
                "soh_range": [float(soh.min()), float(soh.max())],
                "cycle_range": [min(cycles), max(cycles)],
                "batteries": {b: sum(r["battery_id"] == b for r in members)
                              for b in sorted({r["battery_id"] for r in rows})},
                "centroid_z": z[mask].mean(axis=0).tolist(),
                "centroid_raw": raw[mask].mean(axis=0).tolist(),
                "silhouette": float(values[mask].mean()),
            })
        cuts[str(k)] = {"labels": labels.tolist(), "groups": groups,
                        "silhouette": float(values.mean()),
                        "smallest_group": min(g["n"] for g in groups)}

    rho = np.asarray(spearmanr(raw, axis=0).statistic)
    # Rank correlation groups both same- and opposite-direction relationships.
    dissimilarity = np.clip(1 - np.abs(rho), 0, 1)
    np.fill_diagonal(dissimilarity, 0)
    feature_tree = linkage(squareform(dissimilarity, checks=False),
                           method="average", optimal_ordering=True)
    feature_order = leaves_list(feature_tree).tolist()
    feature_cuts = {}
    for k in range(2, 6):
        labels = cut_tree(feature_tree, n_clusters=k).ravel()
        order = list(dict.fromkeys(labels[feature_order]))
        mapping = {int(c): i for i, c in enumerate(order)}
        feature_cuts[str(k)] = [mapping[int(c)] for c in labels]

    # Independent numerical checks, with no target information entering either fit.
    np.testing.assert_allclose(z.mean(axis=0), 0, atol=1e-11)
    np.testing.assert_allclose(z.std(axis=0), 1, atol=1e-11)
    np.testing.assert_allclose((u * singular) @ components, z, atol=1e-11)
    independent_rho = np.corrcoef(rankdata(raw, axis=0), rowvar=False)
    np.testing.assert_allclose(rho, independent_rho, atol=1e-12)
    for cut in cuts.values():
        assert sum(g["n"] for g in cut["groups"]) == len(indices)
        assert all(-1 <= g["silhouette"] <= 1 for g in cut["groups"])
        np.testing.assert_allclose(
            np.average([g["centroid_z"] for g in cut["groups"]], axis=0,
                       weights=[g["n"] for g in cut["groups"]]), 0, atol=1e-11)
    return {"features": feature_keys, "n_input": len(selected), "indices": indices,
            "excluded": [i for i in selected if i not in set(indices)],
            "mean": mean.tolist(), "scale": scale.tolist(),
            "projection": {"scores": scores.tolist(), "components": components[:2].tolist(),
                           "explained_variance_ratio": variance.tolist()},
            "cuts": cuts, "feature_rho": rho.tolist(),
            "feature_tree": feature_tree.tolist(),
            "feature_order": feature_order,
            "feature_cuts": feature_cuts}


def self_test():
    z = np.array([[0.0], [0.1], [10.0], [10.1], [100.0]])
    values = silhouette(squareform(pdist(z)), np.array([0, 0, 1, 1, 2]))
    assert values[-1] == 0 and np.all(values[:-1] > .98)
    np.testing.assert_allclose(
        silhouette(np.zeros((4, 4)), np.array([0, 0, 1, 1])), 0)
    x = np.array([[1., 4., 8.], [2., 3., 2.], [3., 2., 7.], [4., 1., 1.]])
    flipped = x.copy()
    flipped[:, 1] *= -1
    np.testing.assert_allclose(np.abs(spearmanr(x).statistic),
                               np.abs(spearmanr(flipped).statistic))
    assert not {"soh", "capacity", "cycle", "battery_id"} & set(FEATURE_KEYS)
    return {"singleton_silhouette_zero": True, "separated_groups": True,
            "coincident_points": True, "feature_distance_sign_invariant": True,
            "targets_and_identifiers_excluded": True}


def write_summary(payload: dict):
    fit = payload["scopes"]["ALL"]["all"]
    cut = fit["cuts"]["3"]
    lines = ["# Battery cycle and feature clustering", "",
             "Open [clustering.html](../Web/HTML/clustering.html) for both interactive views.", "",
             f"{len(fit['indices'])} complete cycles out of {fit['n_input']}; five flagged charge cycles are excluded without filling missing values.", "",
             "## Three-group exploratory view", "",
             "Group names follow PC1 position, using features only. They are not health classes.", "",
             "| Group | Cycles | Mean SoH (%) | Battery counts |", "|---|---:|---:|---|"]
    for g in cut["groups"]:
        counts = ", ".join(f"{b}: {n}" for b, n in g["batteries"].items() if n)
        lines.append(f"| {g['cluster'] + 1} | {g['n']} | {g['soh_mean']:.1f} | {counts} |")
    lines.extend(["", "Two of the three default groups mix batteries; the third contains only B0006. This combines within-cell aging patterns with between-cell differences, rather than establishing universal health classes.", "",
                  f"The first two principal components retain {sum(fit['projection']['explained_variance_ratio'][:2]) * 100:.1f}% of standardized feature variance. The default three-group silhouette is {cut['silhouette']:.3f}.", "",
                  "## Related features", "",
                  "The default four-group feature cut has the following membership. Strong inverse associations may share a group; the signed heatmap shows their direction.", ""])
    labels = fit["feature_cuts"]["4"]
    for group in range(4):
        members = [FEATURE_KEYS[i] for i in fit["feature_order"] if labels[i] == group]
        lines.append(f"- Group {group + 1}: " + ", ".join(f"`{key}`" for key in members))
    rho = fit["feature_rho"]
    lines.extend(["",
                  f"CC duration and dQ/dV peak have Spearman rho {rho[0][2]:+.3f}; the two resistances have rho {rho[6][7]:+.3f}. CC duration and peak voltage move in opposite directions (rho {rho[0][3]:+.3f}). These describe the 627 complete pooled cycles.", "",
                  "## Method", "", *[f"- {v}" for v in payload["method"]], "",
                  "## Limits", "", *[f"- {v}" for v in payload["caveats"]], "",
                  "Rebuild: `python3 Code/analysis/clustering.py --self-test`.", "",
                  "The full-precision JSON and assignment CSVs sit beside the report. The CSVs retain all 632 source rows; excluded rows have blank coordinates and labels."])
    (RESULTS / "clustering.md").write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    source_before = hashlib.sha256(INPUT.read_bytes()).hexdigest()
    rows = load_rows()
    batteries = sorted({r["battery_id"] for r in rows})
    payload = {
        "features": FEATURES, "batteries": batteries, "default_k": 3,
        "rows": rows,
        "source": {"path": "Reports/cycles_observed_flagged.csv",
                   "sha256": source_before, "n_rows": len(rows)},
        "method": [
            "Each row is one aligned discharge cycle. Only complete observed feature vectors enter clustering; no imputation or interpolation is applied.",
            "For each battery scope and feature setting, center each feature and divide by its population standard deviation (z-score). Fit again when scope or feature setting changes.",
            "Group cycles by agglomerative Ward linkage on Euclidean distances in the full standardized feature space. Cuts at 2–6 groups share the same hierarchy. Three is an illustrative default, not an estimated true number of groups.",
            "PCA (principal component analysis) compresses the standardized features to two axes for display only. Clusters are fitted in the full feature space; apparent two-dimensional overlaps may hide separation.",
            "Capacity, SoH, cycle number and battery ID are excluded from the feature matrix. SoH and battery ID describe groups only after fitting. Group numbers follow feature-only PC1 position and are local to each fit.",
            "Silhouette compares each cycle's mean distance to its own group with its closest other group; (b−a)/max(a,b), from −1 to +1. Singletons are zero. It measures geometric separation, not prediction accuracy.",
            "Related features use Spearman rank correlations on the same complete cycles. Average-linkage hierarchical clustering uses distance 1−|rho|, so strong inverse relationships can share a group. The heatmap preserves signed correlations.",
            "The interval toggle removes rest_time_hours and refits both analyses; it helps reveal sensitivity to the long gaps retained in this observed table.",
        ],
        "caveats": [
            "All four cells are exploratory. Repeated cycles share aging trends and are not independent experimental replicates; these groups do not establish causes, health classes or predictive performance.",
            "Pooling cells mixes differences between batteries with changes within a battery. Compare individual batteries; their refitted coordinates and group numbers are not directly comparable.",
            "Standard scaling does not remove outliers or correct skewness. Long discharge intervals can create very small groups; compare the interval setting and read group sizes alongside silhouette.",
            "The first four charge features are masked in five flagged cycles; their exclusion can affect the result. Source data and missing values are preserved.",
            "The discharge interval includes charging, so it is not pure idle rest. Nearest impedance alignment can use future measurements; temperature rise needs the full discharge. This is a retrospective description, not a certified online input set.",
            "Several features are redundant, so equal per-feature scaling can count shared aging information more than once. PCA variance retained does not certify preserved cluster distances or the existence of discrete natural groups.",
        ],
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                        "scipy": scipy.__version__},
        "scopes": {},
    }
    for battery in ["ALL", *batteries]:
        payload["scopes"][battery] = {name: analyze(rows, battery, keys)
                                       for name, keys in VARIANTS.items()}
    verification = {"source_unchanged": source_before == hashlib.sha256(INPUT.read_bytes()).hexdigest(),
                    "fits_checked": len(payload["scopes"]) * len(VARIANTS),
                    "checks": ["standardized column means and variances", "full PCA reconstruction",
                               "Spearman independently recomputed from ranks", "cluster coverage and weighted centroids"],
                    "self_tests": self_test() if args.self_test else None}
    assert verification["source_unchanged"]
    payload["verification"] = verification
    (RESULTS / "clustering.json").write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n")

    fit = payload["scopes"]["ALL"]["all"]
    positions = {source_index: j for j, source_index in enumerate(fit["indices"])}
    with (RESULTS / "cycle_clusters.csv").open("w", newline="") as handle:
        fields = ["battery_id", "cycle", "soh", "included", "exclusion_reason", "pc1", "pc2"] + [f"cluster_k{k}" for k in KS]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for i, row in enumerate(rows):
            record = {"battery_id": row["battery_id"], "cycle": row["cycle"], "soh": row["soh"], "included": i in positions,
                      "exclusion_reason": "" if i in positions else "missing observed charge features"}
            if i in positions:
                j = positions[i]
                record.update(pc1=fit["projection"]["scores"][j][0], pc2=fit["projection"]["scores"][j][1])
                record.update({f"cluster_k{k}": fit["cuts"][str(k)]["labels"][j] + 1 for k in KS})
            writer.writerow(record)
    with (RESULTS / "feature_clusters.csv").open("w", newline="") as handle:
        fields = ["feature", "order", "group_k4"] + FEATURE_KEYS
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for position, i in enumerate(fit["feature_order"]):
            writer.writerow({"feature": FEATURE_KEYS[i], "order": position + 1,
                             "group_k4": fit["feature_cuts"]["4"][i] + 1,
                             **dict(zip(FEATURE_KEYS, fit["feature_rho"][i]))})
    write_summary(payload)

    def display(value):
        if isinstance(value, dict): return {k: display(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)): return [display(v) for v in value]
        if isinstance(value, float): return round(value, 6)
        return value

    embedded = json.dumps(display(payload), separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    document = (ROOT / "clustering.template.html").read_text().replace("__DATA__", embedded)
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "clustering.html").write_text(document)
    (RESULTS / "clustering_verification.json").write_text(json.dumps(verification, indent=2) + "\n")
    print(f"Built clustering.html: {len(rows)} source rows, {len(fit['indices'])} complete cycles, 10 fits, 50 hierarchy cuts.")
    print(json.dumps(verification))


if __name__ == "__main__":
    main()
