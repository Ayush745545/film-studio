"""Seed a real ComfyUI checkout with fixtures for verify-comfyui-real.ts.

ComfyUI needs actual files on disk for /models/{folder} to list anything, and
workflows live under user/default/workflows.

    COMFYUI_DIR=/path/to/ComfyUI python3 scripts/comfy-fixtures.py
"""
import json
import os

ROOT = os.environ.get("COMFYUI_DIR")
if not ROOT:
    raise SystemExit("Set COMFYUI_DIR to your ComfyUI checkout, e.g.\n"
                     "  COMFYUI_DIR=~/ComfyUI python3 scripts/comfy-fixtures.py")

API_WORKFLOW = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "afs_test_sd15.safetensors"}},
    "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}", "clip": ["1", 1]}},
    "3": {"class_type": "KSampler", "inputs": {
        "seed": "{{seed}}", "steps": "{{steps}}", "cfg": "{{cfg}}",
        "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
        "model": ["1", 0], "positive": ["2", 0], "negative": ["2", 0], "latent_image": ["4", 0]}},
    "4": {"class_type": "EmptyLatentImage", "inputs": {"width": "{{width}}", "height": "{{height}}", "batch_size": 1}},
    "5": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["1", 2]}},
    "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": "AFS", "images": ["5", 0]}},
}

UI_WORKFLOW = {
    "last_node_id": 6, "last_link_id": 5,
    "nodes": [{"id": 1, "type": "CheckpointLoaderSimple", "pos": [50, 50], "size": [300, 100]}],
    "links": [[1, 1, 0, 3, 0, "MODEL"]],
    "groups": [], "config": {}, "extra": {}, "version": 0.4,
}


def main():
    # Placeholder weight files. Contents are never read: only the /models
    # filename listing and ComfyUI's value_not_in_list check care about names.
    for folder, name in [("checkpoints", "afs_test_sd15.safetensors"),
                         ("loras", "afs_test_lora.safetensors"),
                         ("vae", "afs_test_vae.safetensors")]:
        d = os.path.join(ROOT, "models", folder)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "wb") as f:
            f.write(b"\x00" * 64)

    wd = os.path.join(ROOT, "user", "default", "workflows")
    os.makedirs(os.path.join(wd, "vid"), exist_ok=True)
    for rel, payload in [("afs_hero_api.json", API_WORKFLOW),
                         ("afs_hero_editor.json", UI_WORKFLOW),
                         ("vid/afs_nested.json", API_WORKFLOW)]:
        with open(os.path.join(wd, rel), "w") as f:
            json.dump(payload, f)

    print("fixtures written under", ROOT)


if __name__ == "__main__":
    main()
