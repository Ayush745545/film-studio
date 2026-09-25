'use client';
import * as React from 'react';
import { subscribeEvents } from '@/lib/client/events';
import { useApp } from '@/store/app';
import { useProject } from '@/store/project';
import { useEditor } from '@/store/editor';

/**
 * Bridges the SSE stream into the stores.
 *
 * Job progress updates the queue and the project's stage indicators; asset
 * events refresh the asset lists; project events keep multi-tab edits coherent.
 */
export function useEventBridge() {
  const applyEvent = useApp(s => s.applyEvent);
  const reload = useApp(s => s.reload);
  React.useEffect(() => {
    return subscribeEvents(e => {
      applyEvent(e);
      const p = useProject.getState();
      if (e.type === 'job:update') p.applyJobEvent(e.job);
      if (e.type === 'asset:created' && e.asset.projectId && e.asset.projectId === p.id) {
        useProject.setState(s => ({
          assets: s.assets.some(a => a.id === e.asset.id) ? s.assets : [e.asset, ...s.assets].slice(0, 600)
        }));
      }
      if (e.type === 'project:update' && e.projectId === p.id && !useEditor.getState().dirty) {
        useProject.setState(s => ({ project: { ...s.project, ...e.patch } }));
      }
      if (e.type === 'credits:update') void reload('subscription');
    });
  }, [applyEvent, reload]);
}
