import { getDb } from '@/lib/db';
import { createProject, setStageState } from '@/lib/project';
import { 
  runStory, runScript, runCast, runWorld, runBreakdown, 
  runSoundDesign, runDialogueExtract, runAssemble, runEditPlan
} from '@/lib/pipeline/domain';
import { runMediaJob } from '@/lib/pipeline/generate';
import { runExport } from '@/lib/pipeline/export';
import type { Project, Idea, GenerationJob } from '@/types';
import type { JobContext } from '@/lib/queue';
import { uid, nowIso } from '@/lib/ids';

async function seedAllStages() {
  const db = await getDb();
  
  // Disable Ollama and other local providers that aren't running
  const ollamaProvider = await db.repo('providers').findUnique('ollama') as any;
  if (ollamaProvider) {
    await db.repo('providers').update('ollama', { enabled: false } as any);
    console.log('Disabled Ollama provider');
  }
  const lmstudioProvider = await db.repo('providers').findUnique('lmstudio') as any;
  if (lmstudioProvider) {
    await db.repo('providers').update('lmstudio', { enabled: false } as any);
    console.log('Disabled LM Studio provider');
  }
  const comfyuiProvider = await db.repo('providers').findUnique('comfyui') as any;
  if (comfyuiProvider) {
    await db.repo('providers').update('comfyui', { enabled: false } as any);
    console.log('Disabled ComfyUI provider');
  }
  
  const users = await db.repo('users').findMany({}) as any[];
  const user = users[0];
  if (!user) throw new Error('No user found');
  
  const existing = await db.repo('projects').findUnique('prj_e425be1660824933a803') as Project | null;
  let project: Project;
  
  if (existing) {
    project = existing;
    console.log('Found existing project:', project.name);
    
    const idea: Idea = {
      text: "A sound archivist restoring a damaged tape hears a conversation that was never recorded.",
      genre: "neo-noir thriller",
      tone: "dread, restrained",
      theme: "memory as a form of debt",
      setting: "a coastal city in winter",
      conflict: "what she wants cannot coexist with what she is responsible for",
      characters: "",
      visualStyle: "long lenses, practical sources only, negative fill",
      timePeriod: "",
      audience: "",
      duration: "",
      ending: "She gets what she asked for and understands too late what it cost.",
      pacing: "slow burn with two accelerations"
    };
    
    await db.repo('projects').update(project.id, { 
      idea, 
      stage: 'idea',
      stageStates: Object.fromEntries([
        'idea', 'story', 'script', 'characters', 'world', 'scenes', 'storyboard', 'shots',
        'video', 'voice', 'sound', 'aiedit', 'editor', 'color', 'export'
      ].map(s => [s, 'empty'])),
      updatedAt: nowIso()
    } as any);
    console.log('Updated idea');
  } else {
    console.log('Project not found, creating...');
    project = await createProject(user.id, {
      name: 'The Last Memory',
      type: 'short-film',
      idea: {
        text: "A sound archivist restoring a damaged tape hears a conversation that was never recorded.",
        genre: "neo-noir thriller",
        tone: "dread, restrained",
        theme: "memory as a form of debt",
        setting: "a coastal city in winter",
        conflict: "what she wants cannot coexist with what she is responsible for",
        characters: "",
        visualStyle: "long lenses, practical sources only, negative fill",
        timePeriod: "",
        audience: "",
        duration: "",
        ending: "She gets what she asked for and understands too late what it cost.",
        pacing: "slow burn with two accelerations"
      }
    });
    console.log('Created project:', project.id);
  }

  /**
   * A stub JobContext for offline seeding. `job` is filled in per stage inside
   * the loop below, because handlers read `ctx.job` as well as the argument.
   */
  const makeContext = (job: GenerationJob): JobContext => ({
    job,
    update: async () => {},
    progress: async (p: number, msg: string) => console.log(`  [${Math.round(p * 100)}%] ${msg ?? ''}`),
    log: async (level, msg: string) => console.log(`  ${level}: ${msg}`),
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as any,
  });

  /**
   * One seed stage. `fn` is typed as a `JobHandler`-shaped function so the
   * zero-argument stages below stay assignable and the `(job, ctx)` stages get
   * their parameters inferred instead of falling back to implicit `any`.
   */
  type SeedStage = {
    name: string;
    fn: (job: GenerationJob, ctx: JobContext) => Promise<unknown>;
    input?: Record<string, unknown>;
  };

  const stages: SeedStage[] = [
    { name: 'story', fn: runStory },
    { name: 'script', fn: runScript },
    { name: 'characters', fn: runCast },
    { name: 'world', fn: runWorld },
    { name: 'scenes', fn: runBreakdown },
    { name: 'shots', fn: async () => { await setStageState(project.id, 'shots', 'ready'); } },
    { name: 'storyboard', fn: async (job, ctx) => { 
      const mediaJob: GenerationJob = { 
        ...job, kind: 'image', input: { ...job.input, kind: 'storyboard' } 
      };
      await runMediaJob(mediaJob, ctx);
      await setStageState(project.id, 'storyboard', 'ready');
    }},
    { name: 'video', fn: async (job, ctx) => { 
      const mediaJob: GenerationJob = { 
        ...job, kind: 'video', input: { ...job.input, kind: 'video' } 
      };
      await runMediaJob(mediaJob, ctx);
      await setStageState(project.id, 'video', 'ready');
    }},
    { name: 'voice', fn: async (job, ctx) => { 
      const mediaJob: GenerationJob = { 
        ...job, kind: 'voice', input: { ...job.input, kind: 'voice' } 
      };
      await runMediaJob(mediaJob, ctx);
      await setStageState(project.id, 'voice', 'ready');
    }},
    { name: 'sound', fn: runSoundDesign },
    { name: 'aiedit', fn: runEditPlan },
    { name: 'editor', fn: async () => { await setStageState(project.id, 'editor', 'ready'); } },
    { name: 'color', fn: async () => { await setStageState(project.id, 'color', 'ready'); } },
    { name: 'export', fn: runExport, input: { 
      projectId: project.id, 
      engine: 'bundle' as const,
      format: 'zip' as const,
      codec: 'h264' as const,
      resolution: '1080p' as const,
      fps: 24,
      aspectRatio: '16:9' as const,
      quality: 'high' as const,
      bitrate: 10000,
      label: 'Project Bundle'
    }},
  ];

  for (const stage of stages) {
    console.log(`\n=== Running ${stage.name} ===`);
    try {
      const job: GenerationJob = {
        id: uid('job'),
        projectId: project.id,
        userId: user.id,
        kind: stage.name as any,
        label: `Generate ${stage.name}`,
        sublabel: '',
        status: 'running',
        progress: 0,
        modelId: null,
        providerId: null,
        presetId: null,
        input: { projectId: project.id, ...stage.input },
        output: {},
        assetIds: [],
        error: null,
        credits: 0,
        priority: 0,
        attempts: 0,
        maxAttempts: 1,
        queuePosition: 0,
        stage: stage.name as any,
        automationRunId: null,
        logs: [],
        demo: true,
        parentJobId: null,
        batchId: null,
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: null,
      };
      
      await stage.fn(job, makeContext(job));
      await setStageState(project.id, stage.name as any, 'ready');
      console.log(`✓ ${stage.name} completed`);
    } catch (err: any) {
      console.error(`✗ ${stage.name} failed:`, err.message);
    }
  }

  console.log('\n=== All stages completed ===');
  process.exit(0);
}

seedAllStages().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
