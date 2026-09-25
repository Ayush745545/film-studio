import { api, badRequest } from '@/lib/api';
import { createProject, listProjects } from '@/lib/project';
import { audit } from '@/lib/security/audit';
import { PROJECT_TYPES } from '@/types';
import type { Idea, ProjectSettings, ProjectType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const q = query().get('q') ?? undefined;
  const projects = await listProjects(user.id, q);
  return { projects, types: PROJECT_TYPES };
});

export const POST = api(async ({ user, json, ip }) => {
  const body = await json<{
    name?: string; type?: ProjectType; settings?: Partial<ProjectSettings>;
    idea?: Partial<Idea>; description?: string; tags?: string[];
  }>();
  const name = (body.name ?? '').trim();
  if (!name) throw badRequest('Project name is required', 'Give the project a working title — you can rename it later.');
  if (name.length > 120) throw badRequest('Project name is too long', 'Keep it under 120 characters.');
  const project = await createProject(user.id, { name, type: body.type, settings: body.settings, idea: body.idea, description: body.description, tags: body.tags });
  await audit({ userId: user.id, action: 'project.create', entity: 'project', entityId: project.id, ip, meta: { type: project.type } });
  return project;
}, { auditAction: 'project.create' });
