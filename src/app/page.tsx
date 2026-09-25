'use client';
import * as React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CreateScreen } from '@/components/home/CreateScreen';
export const dynamic = 'force-dynamic';
export default function HomePage() {
  return <AppShell><CreateScreen /></AppShell>;
}