'use client';
import { Home, Film } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-bg px-6">
      <Film size={48} className="text-ink3" />
      <div className="text-center">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mt-2 text-[14px] text-ink2">The page you're looking for doesn't exist or has been moved.</p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => window.location.href = '/'}>
          <Home size={14} />Back to home
        </Button>
        <Button variant="ghost" onClick={() => window.location.href = '/projects'}>
          Browse projects
        </Button>
      </div>
    </div>
  );
}