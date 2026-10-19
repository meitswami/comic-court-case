import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import logo from '@/assets/logo.png';
import { CPButton } from './CPButton';

/** App header for the case-prep pages; keeps the eNyayaSetu brand mark. */
export function CasePrepHeader({ email, children }: { email?: string | null; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="border-b-2 border-foreground bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CPButton variant="quiet" size="icon" onClick={() => navigate('/')} aria-label="Home"><Home /></CPButton>
          <img src={logo} alt="eNyayaSetu" className="h-9 w-9" />
          <div className="min-w-0">
            <p className="brand-title font-bangers text-xl leading-none tracking-wide text-primary">Case prep</p>
            <p className="truncate text-xs text-muted-foreground">Cited facts, chronology and briefs from your case papers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {children}
          <CPButton variant="quiet" size="sm" onClick={() => navigate('/dashboard')}>My cases</CPButton>
          {email ? <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground md:inline">{email}</span> : null}
        </div>
      </div>
    </header>
  );
}
