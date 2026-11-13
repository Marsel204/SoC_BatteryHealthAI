"""Test setup: importing the server's paths module puts the pinned upstream snapshot
(root data/ and src/) on sys.path, so `src.data_loader` and `src.feature_engineering` resolve
to the checksummed originals instead of a copy."""
import server.paths  # noqa: F401
