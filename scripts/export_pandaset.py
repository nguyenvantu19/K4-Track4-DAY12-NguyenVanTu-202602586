"""Export PandaSet ego poses, camera indices and traffic cuboids for the browser lab."""

import argparse
import bisect
import json
import math
from pathlib import Path
import shutil

import pandas as pd


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def export_scene(folder, output, copy_camera=False):
    lidar = folder / "lidar"
    camera = folder / "camera" / "front_camera"
    poses = read_json(lidar / "poses.json")
    timestamps = read_json(lidar / "timestamps.json")
    camera_times = read_json(camera / "timestamps.json")
    origin, end = poses[0]["position"], poses[-1]["position"]
    yaw = math.atan2(end["y"] - origin["y"], end["x"] - origin["x"])
    forward_x, forward_y = math.cos(yaw), math.sin(yaw)

    def position(x, y):
        x, y = x - origin["x"], y - origin["y"]
        return [round(x * forward_x + y * forward_y, 3),
                round(1.75 + x * forward_y - y * forward_x, 3)]

    def heading(local_yaw):
        angle = yaw - local_yaw - math.pi / 2
        return round(math.atan2(math.sin(angle), math.cos(angle)), 5)

    frames, actors = [], {}
    if len(poses) != len(timestamps) or len(timestamps) < 2 or not camera_times:
        raise ValueError(f"Incomplete timestamps or poses in {folder}")
    if any(a >= b for a, b in zip(timestamps, timestamps[1:])) or any(
        a >= b for a, b in zip(camera_times, camera_times[1:])
    ):
        raise ValueError(f"Timestamps are not strictly increasing in {folder}")
    for index, (pose, timestamp) in enumerate(zip(poses, timestamps)):
        base = folder / "annotations" / "cuboids" / f"{index:02}.pkl"
        path = base if base.is_file() else base.with_suffix(".pkl.gz")
        # PandaSet distributes these as pandas pickles. Use a trusted dataset copy.
        cuboids = pd.read_pickle(path)
        cuboids = cuboids[cuboids["cuboids.sensor_id"] != 1]
        tracks = []
        for box in cuboids.to_dict(orient="records"):
            label = box["label"]
            if label in {"Pedestrian", "Pedestrian with Object", "Animals - Other"}:
                kind = "ped"
            elif label in {"Bicycle", "Motorcycle", "Personal Mobility Device"}:
                kind = "bike"
            elif any(word in label for word in ("Car", "Truck", "Bus", "Vehicle", "Trailer", "Tram", "Train")):
                kind = "car"
            else:
                continue
            x, z = position(box["position.x"], box["position.y"])
            if abs(z) > 32 or x < -40 or x > 170:
                continue
            key = box["uuid"]
            if key not in actors:
                actors[key] = [len(actors), label, kind, round(box["dimensions.y"], 3),
                               round(box["dimensions.x"], 3), round(box["dimensions.z"], 3)]
            tracks.append([actors[key][0], x, z, heading(box["yaw"])])
        orientation = pose["heading"]
        ego_yaw = math.atan2(2 * (orientation["w"] * orientation["z"] + orientation["x"] * orientation["y"]),
                             1 - 2 * (orientation["y"] ** 2 + orientation["z"] ** 2))
        frame_camera = bisect.bisect_left(camera_times, timestamp)
        frame_camera = min((max(0, frame_camera - 1), min(len(camera_times) - 1, frame_camera)),
                           key=lambda candidate: abs(camera_times[candidate] - timestamp))
        camera_name = f"{frame_camera:02}.jpg"
        if copy_camera:
            target = output.parent / folder.name / "camera" / "front_camera" / camera_name
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(camera / camera_name, target)
        frames.append({
            "t": round(timestamp - timestamps[0], 5),
            "ego": [*position(pose["position"]["x"], pose["position"]["y"]), heading(ego_yaw)],
            "camera": camera_name, "actors": tracks,
        })
    return {"id": folder.name, "actors": [actor[1:] for actor in actors.values()], "frames": frames}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Directory containing the PandaSet sequences")
    parser.add_argument("output", type=Path)
    parser.add_argument("--scenes", nargs="+", default=["001", "002", "003"])
    parser.add_argument("--copy-camera", action="store_true")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    scenes = [export_scene(args.root / scene, args.output, args.copy_camera) for scene in args.scenes]
    args.output.write_text(json.dumps({"scenes": scenes}, ensure_ascii=False, allow_nan=False,
                                      separators=(",", ":")), encoding="utf-8")
    for scene in scenes:
        print(f"{scene['id']}: {len(scene['frames'])} frames, {len(scene['actors'])} traffic tracks")


if __name__ == "__main__":
    main()
