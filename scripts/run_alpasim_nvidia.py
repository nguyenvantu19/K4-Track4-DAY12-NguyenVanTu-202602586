"""Run VaVAM and Alpamayo 1.5 against one NuRec scene on an AlpaSim GPU host."""

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("alpasim_dir", type=Path, help="Root of the configured AlpaSim checkout")
    parser.add_argument("scene_id", help="One scene ID from AlpaSim's scene catalog")
    parser.add_argument("output_dir", type=Path, help="Parent directory for a new results folder")
    args = parser.parse_args(argv)

    checkout = args.alpasim_dir.resolve()
    if not (checkout / "setup_local_env.sh").is_file() or not (checkout / "uv.lock").is_file():
        parser.error(f"expected the root of an AlpaSim checkout: {checkout}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", args.scene_id):
        parser.error("pass one AlpaSim scene ID")
    for program in ("uv", "docker", "nvidia-smi"):
        if not shutil.which(program):
            parser.error(f"{program} is missing. Complete the AlpaSim onboarding on the GPU host.")

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="alpasim-", dir=output))
    print(f"Scene {args.scene_id}\nResults {run_dir}", flush=True)

    for driver, layouts in (("vavam", "[DEFAULT]"), ("alpamayo1_5", "[DEFAULT,REASONING_OVERLAY]")):
        try:
            subprocess.run(
                ["uv", "run", "alpasim_wizard", "deploy=local", "topology=1gpu",
                 f"driver={driver}", f"scenes.scene_ids=[{args.scene_id}]",
                 "runtime.simulation_config.n_rollouts=1", f"eval.video.video_layouts={layouts}",
                 f"wizard.log_dir={run_dir / driver}"],
                cwd=checkout,
                check=True,
            )
        except subprocess.CalledProcessError as error:
            print(f"{driver} failed. Check the output and logs under {run_dir}.", flush=True)
            return error.returncode
    print("Copy evaluation MP4s and aggregate/metrics_results.txt from each driver directory to review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
