/**
 * ComfyUI workflow format helpers.
 *
 * ComfyUI exports two incompatible JSON shapes and the difference matters,
 * because only one of them can be submitted to `POST /prompt`:
 *
 *   • **API format** — a flat map of `nodeId → { class_type, inputs }`, produced
 *     by "Save (API Format)" / the `prompt` payload. This is what
 *     `adapters/comfyui.ts` patches when it substitutes `{{prompt}}`, seeds,
 *     dimensions and node overrides.
 *   • **UI format** — the full editor document with a `nodes` array, `links`,
 *     viewport state, etc. This is what the frontend saves under
 *     `userdata/workflows/*.json`, and what you get from a plain "Save".
 *
 * Submitting UI format to `/prompt` fails node validation with an error that
 * does not explain the real problem, so both the proxy and the Models screen
 * classify a workflow before offering to load it into the router.
 */
export type ComfyWorkflowFormat = 'api' | 'ui' | 'unknown';

export function detectFormat(json: unknown): ComfyWorkflowFormat {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'unknown';
  const o = json as Record<string, unknown>;
  // Editor document: has a node array and/or a link table.
  if (Array.isArray(o.nodes) || Array.isArray(o.links)) return 'ui';
  const values = Object.values(o);
  if (!values.length) return 'unknown';
  // API graph: every top-level entry is a node with a class_type.
  if (values.every(v => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && 'class_type' in (v as object))) {
    return 'api';
  }
  return 'unknown';
}

/** Node classes whose presence means the graph renders video rather than a still. */
const VIDEO_NODES = /VideoCombine|VHS_|SaveVideo|SaveAnimated|AnimateDiff|VideoHelperSuite/i;

export function inferWorkflowConfig(json: unknown): Record<string, string> {
  if (detectFormat(json) !== 'api') return {};
  const entries = Object.entries(json as Record<string, unknown>);
  const nodes = entries.map(([id, value]) => {
    const node = value as { class_type?: string; inputs?: Record<string, unknown> };
    return { id, classType: node.class_type ?? '', inputs: node.inputs ?? {} };
  });
  const find = (pattern: RegExp) => nodes.find(node => pattern.test(node.classType));
  const prompts = nodes.filter(node => /cliptextencode|textencode|prompt/i.test(node.classType));
  const negative = prompts.find(node => /negative|neg\b/i.test(String(node.inputs.text ?? ''))) ?? prompts[1];
  const prompt = prompts.find(node => node.id !== negative?.id) ?? prompts[0];
  const sampler = find(/ksampler|sampler/i);
  const latent = find(/emptylatent|emptysd3latent|latentimage/i);
  const loader = find(/checkpointloader|unetloader|model.*loader/i);
  const image = find(/loadimage/i);
  const lora = find(/lora/i);
  const duration = nodes.find(node => ['frame_load_cap', 'num_frames', 'frames', 'length'].some(field => field in node.inputs));
  const config: Record<string, string> = {
    ...(prompt ? { promptNode: prompt.id, promptField: String(prompt.inputs.text !== undefined ? 'text' : 'prompt') } : {}),
    ...(negative ? { negativeNode: negative.id, negativeField: String(negative.inputs.text !== undefined ? 'text' : 'prompt') } : {}),
    ...(sampler && 'seed' in sampler.inputs ? { seedNode: sampler.id, seedField: 'seed' } : sampler && 'noise_seed' in sampler.inputs ? { seedNode: sampler.id, seedField: 'noise_seed' } : {}),
    ...(sampler && 'steps' in sampler.inputs ? { stepsNode: sampler.id, stepsField: 'steps' } : {}),
    ...(sampler && 'cfg' in sampler.inputs ? { cfgNode: sampler.id, cfgField: 'cfg' } : {}),
    ...(latent && 'width' in latent.inputs ? { widthNode: latent.id, widthField: 'width' } : {}),
    ...(latent && 'height' in latent.inputs ? { heightNode: latent.id, heightField: 'height' } : {}),
    ...(image ? { imageNode: image.id, imageField: 'image' } : {}),
    ...(loader ? { checkpointNode: loader.id, checkpointField: 'ckpt_name', checkpoint: String(loader.inputs.ckpt_name ?? loader.inputs.model_name ?? '') } : {}),
    ...(lora ? { loraNode: lora.id, lora: String(lora.inputs.lora_name ?? '') } : {}),
    ...(duration ? { durationNode: duration.id, durationField: ['frame_load_cap', 'num_frames', 'frames', 'length'].find(field => field in duration.inputs) ?? 'length' } : {})
  };
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value));
}

export function inferKind(json: unknown): 'image' | 'video' {
  if (!json || typeof json !== 'object') return 'image';
  let haystack = '';
  for (const node of Object.values(json as Record<string, unknown>)) {
    const t = (node as { class_type?: unknown })?.class_type;
    if (typeof t === 'string') haystack += `${t} `;
  }
  return VIDEO_NODES.test(haystack) ? 'video' : 'image';
}

/**
 * A stable, provider-unique model id for a workflow.
 *
 * `models` has `@@unique([providerId, driverModel])`, so loading two workflows
 * with a hard-coded id makes the second one fail on a constraint violation.
 * Subfolders are folded in as `--` rather than dropped, because
 * `workflows/a/shot.json` and `workflows/b/shot.json` are different workflows
 * and must not collapse onto the same id.
 */
export function workflowDriverModel(pathOrName: string): string {
  const stem = pathOrName
    .replace(/^workflows\//, '')
    .replace(/\.(workflow\.)?json$/i, '')
    .toLowerCase()
    .replace(/\/+/g, '--')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `workflow:${stem || `custom-${Date.now().toString(36)}`}`;
}

/** Human label for a workflow path, minus the folder and extension. */
export function workflowLabel(pathOrName: string): string {
  return pathOrName.replace(/^workflows\//, '').replace(/\.(workflow\.)?json$/i, '') || 'Untitled workflow';
}
