import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ActivityIn,
  APIErrorDetail,
  DanglingPolicy,
  ExtractedProblem,
  InputMode,
  SolveRequest,
  SolveResponse,
  TimeMode,
  VariancePolicy,
} from './types/cpm';
import { extract, getHealth, solve, solveImage, ApiError } from './api';
import { Header } from './components/Header';
import { InputCard } from './components/InputCard';
import { ResultsView } from './components/ResultsView';
import { ErrorAlert } from './components/ErrorAlert';
import './App.css';

// Default initial activities: Q1 Manuscript Preparation
const DEFAULT_ACTIVITIES: ActivityIn[] = [
  { id: '1', name: 'A', description: 'Manuscript Draft', predecessors: [], duration: 5 },
  { id: '2', name: 'B', description: 'Submit to Editor', predecessors: ['A'], duration: 6 },
  { id: '3', name: 'C', description: 'Professional Technical Review', predecessors: ['B'], duration: 4 },
  { id: '4', name: 'D', description: 'Design Layout', predecessors: ['B'], duration: 5 },
  { id: '5', name: 'E', description: 'Final Corrections', predecessors: ['C'], duration: 3 },
  { id: '6', name: 'F', description: 'Final Layout Approval', predecessors: ['D'], duration: 2 },
  { id: '7', name: 'G', description: 'Send to Printer', predecessors: ['E', 'F'], duration: 4 },
];

export const App: React.FC = () => {
  // Backend config & keys
  const [apiUrl, setApiUrl] = useState<string>(
    () => localStorage.getItem('cpm_api_url') || import.meta.env.VITE_API_URL || ''
  );
  const [accessKey, setAccessKey] = useState<string>(
    () => sessionStorage.getItem('cpm_access_key') || ''
  );
  const [anthropicKey, setAnthropicKey] = useState<string>(
    () => sessionStorage.getItem('cpm_anthropic_key') || localStorage.getItem('cpm_anthropic_key') || ''
  );
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(
    () => (localStorage.getItem('cpm_theme') as 'system' | 'light' | 'dark') || 'system'
  );
  const [hasServerVisionKey, setHasServerVisionKey] = useState(false);
  const [isBackendHealthy, setIsBackendHealthy] = useState(true);

  // Problem definition
  const [title, setTitle] = useState('Manuscript Preparation (CPM)');
  const [mode, setMode] = useState<InputMode>('predecessors');
  const [timeMode, setTimeMode] = useState<TimeMode>('duration');
  const [activities, setActivities] = useState<ActivityIn[]>(DEFAULT_ACTIVITIES);

  // Advanced options
  const [roundTe, setRoundTe] = useState(false);
  const [variancePolicy, setVariancePolicy] = useState<VariancePolicy>('max');
  const [targetTime, setTargetTime] = useState('');
  const [targetDelta, setTargetDelta] = useState('');
  const [targetProbability, setTargetProbability] = useState('');
  const [renumber, setRenumber] = useState('auto');
  const [danglingPolicy, setDanglingPolicy] = useState<DanglingPolicy>('connect');
  const [strictEstimates, setStrictEstimates] = useState(false);
  const [crashTarget, setCrashTarget] = useState('');

  // Results & Error state
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [lastSolvedSnapshot, setLastSolvedSnapshot] = useState<string | null>(null);
  const [error, setError] = useState<APIErrorDetail | null>(null);
  const [verifyNotes, setVerifyNotes] = useState<string[] | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // Synchronize keys to storage
  const handleApiUrlChange = (url: string) => {
    setApiUrl(url);
    localStorage.setItem('cpm_api_url', url);
  };

  const handleAccessKeyChange = (key: string) => {
    setAccessKey(key);
    sessionStorage.setItem('cpm_access_key', key);
  };

  const handleAnthropicKeyChange = (key: string) => {
    setAnthropicKey(key);
    sessionStorage.setItem('cpm_anthropic_key', key);
    localStorage.setItem('cpm_anthropic_key', key);
  };

  const handleThemeChange = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    localStorage.setItem('cpm_theme', t);
  };

  // Apply theme class to document root with live system preference sync
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      if (theme === 'system') {
        root.setAttribute('data-theme', media.matches ? 'dark' : 'light');
      } else {
        root.setAttribute('data-theme', theme);
      }
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  // Check health for backend connectivity
  useEffect(() => {
    getHealth(apiUrl)
      .then((h) => {
        setHasServerVisionKey(h.vision_key_configured);
        setIsBackendHealthy(true);
      })
      .catch(() => {
        setHasServerVisionKey(false);
        setIsBackendHealthy(false);
      });
  }, [apiUrl]);

  // Find offending activity names from error message or details
  const offendingActivityNames = React.useMemo(() => {
    if (!error) return [];
    const offenders: string[] = [];

    // Cycle details
    if (error.details && Array.isArray(error.details.cycle)) {
      offenders.push(...error.details.cycle);
    }

    // Check if error message names any activity in table
    activities.forEach((a) => {
      if (a.name && error.message.includes(`'${a.name}'`)) {
        offenders.push(String(a.name));
      } else if (a.name && error.message.includes(` ${a.name} `)) {
        offenders.push(String(a.name));
      }
    });

    return Array.from(new Set(offenders));
  }, [error, activities]);

  // Build Solve Request object
  const buildRequest = useCallback((): SolveRequest => {
    const filteredActs = activities.map((act) => {
      const a: ActivityIn = { ...act };
      if (mode === 'predecessors') {
        delete a.start_node;
        delete a.end_node;
      } else if (mode === 'nodes') {
        delete a.predecessors;
      }
      if (timeMode === 'duration') {
        delete a.optimistic;
        delete a.most_likely;
        delete a.pessimistic;
      } else if (timeMode === 'pert') {
        delete a.duration;
      }
      return a;
    });

    const req: SolveRequest = {
      title: title || undefined,
      mode,
      activities: filteredActs,
      round_te: roundTe,
      variance_policy: variancePolicy,
      dangling_policy: danglingPolicy,
      strict_estimates: strictEstimates,
    };

    if (renumber === 'true') req.renumber = true;
    else if (renumber === 'false') req.renumber = false;

    if (targetTime.trim() !== '') req.target_time = Number(targetTime.replace(',', '.'));
    if (targetDelta.trim() !== '') req.target_delta = Number(targetDelta.replace(',', '.'));
    if (targetProbability.trim() !== '') req.target_probability = Number(targetProbability.replace(',', '.'));
    if (crashTarget.trim() !== '') req.crash_target = Number(crashTarget.replace(',', '.'));

    return req;
  }, [
    title,
    mode,
    timeMode,
    activities,
    roundTe,
    variancePolicy,
    danglingPolicy,
    strictEstimates,
    renumber,
    targetTime,
    targetDelta,
    targetProbability,
    crashTarget,
  ]);

  const scrollToResults = useCallback(() => {
    setTimeout(() => {
      const el = document.getElementById('results-section');
      if (el) {
        const headerOffset = 80;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 80);
  }, []);

  // Execute solve
  const handleSolve = async () => {
    if (isSolving) return;
    setIsSolving(true);
    setError(null);
    try {
      const req = buildRequest();
      const res = await solve(req, apiUrl, accessKey);
      setResult(res);
      setLastSolvedSnapshot(JSON.stringify(req));
      scrollToResults();
    } catch (err: any) {
      setResult(null);
      setLastSolvedSnapshot(null);
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message, details: err.details });
      } else {
        setError({ code: 'network_error', message: err.message || 'Failed to communicate with solver.' });
      }
    } finally {
      setIsSolving(false);
    }
  };

  // Load sample problem
  const handleSelectSample = (key: string, sample: any) => {
    setTitle(sample.title || key);
    setError(null);
    setVerifyNotes(null);

    const acts: ActivityIn[] = (sample.activities || []).map((a: any, idx: number) => ({
      ...a,
      id: `sample-${idx}`,
    }));
    setActivities(acts);

    const hasNodes = acts.some((a) => a.start_node !== undefined && a.start_node !== null);
    setMode(hasNodes ? 'nodes' : 'predecessors');

    const hasPert = acts.some((a) => a.optimistic !== undefined && a.optimistic !== null);
    setTimeMode(hasPert ? 'pert' : 'duration');

    setRoundTe(Boolean(sample.round_te));
    setTargetTime(sample.target_time !== undefined && sample.target_time !== null ? String(sample.target_time) : '');
    setTargetDelta(sample.target_delta !== undefined && sample.target_delta !== null ? String(sample.target_delta) : '');
    setTargetProbability(sample.target_probability !== undefined && sample.target_probability !== null ? String(sample.target_probability) : '');
    setCrashTarget(sample.crash_target !== undefined && sample.crash_target !== null ? String(sample.crash_target) : '');

    // Automatically solve selected sample so user sees results instantly
    setTimeout(async () => {
      setIsSolving(true);
      try {
        const req: SolveRequest = {
          title: sample.title || key,
          mode: hasNodes ? 'nodes' : 'predecessors',
          activities: acts,
          round_te: Boolean(sample.round_te),
          target_time: sample.target_time,
          target_delta: sample.target_delta,
          target_probability: sample.target_probability,
          crash_target: sample.crash_target,
        };
        const res = await solve(req, apiUrl, accessKey);
        setResult(res);
        setLastSolvedSnapshot(JSON.stringify(req));
        scrollToResults();
      } catch (err: any) {
        setResult(null);
        setLastSolvedSnapshot(null);
        if (err instanceof ApiError) {
          setError({ code: err.code, message: err.message, details: err.details });
        } else {
          setError({ code: 'network_error', message: err.message || 'Auto solve failed.' });
        }
      } finally {
        setIsSolving(false);
      }
    }, 50);
  };

  // Populate state from extracted problem
  const applyExtractedProblem = (extracted: ExtractedProblem, notes?: string[]) => {
    if (extracted.title) setTitle(extracted.title);
    if (extracted.mode) setMode(extracted.mode);

    if (extracted.activities && extracted.activities.length > 0) {
      setActivities(
        extracted.activities.map((a, idx) => ({
          ...a,
          id: `ext-${idx}-${Date.now()}`,
        }))
      );
      const hasPert = extracted.activities.some((a) => a.optimistic !== undefined && a.optimistic !== null);
      setTimeMode(hasPert ? 'pert' : 'duration');
    }

    if (extracted.round_te !== undefined) setRoundTe(extracted.round_te);
    if (extracted.target_time !== undefined && extracted.target_time !== null) setTargetTime(String(extracted.target_time));
    if (extracted.target_delta !== undefined && extracted.target_delta !== null) setTargetDelta(String(extracted.target_delta));
    if (extracted.target_probability !== undefined && extracted.target_probability !== null) setTargetProbability(String(extracted.target_probability));
    if (extracted.crash_target !== undefined && extracted.crash_target !== null) setCrashTarget(String(extracted.crash_target));

    if (notes && notes.length > 0) {
      setVerifyNotes(notes);
    }
  };

  // Extract image only
  const handleExtractImage = async (file: File) => {
    setIsExtracting(true);
    setError(null);
    try {
      const extracted = await extract(file, anthropicKey || undefined, apiUrl, accessKey);
      applyExtractedProblem(extracted, extracted.notes);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message, details: err.details });
      } else {
        setError({ code: 'extract_error', message: err.message || 'Image extraction failed.' });
      }
    } finally {
      setIsExtracting(false);
    }
  };

  // One-tap extract and solve
  const handleExtractAndSolveImage = async (file: File) => {
    setIsExtracting(true);
    setError(null);
    try {
      const res = await solveImage(file, anthropicKey || undefined, apiUrl, accessKey);
      if (res.extracted) {
        applyExtractedProblem(res.extracted, res.notes);
      }
      if (res.error) {
        setError(res.error);
      } else if (res.result) {
        setResult(res.result);
        try {
          setLastSolvedSnapshot(JSON.stringify(buildRequest()));
        } catch {
          setLastSolvedSnapshot(null);
        }
        scrollToResults();
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError({ code: err.code, message: err.message, details: err.details });
      } else {
        setError({ code: 'extract_solve_error', message: err.message || 'Vision solve failed.' });
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const isSolvingRef = useRef(isSolving);
  const handleSolveRef = useRef(handleSolve);
  useEffect(() => {
    isSolvingRef.current = isSolving;
    handleSolveRef.current = handleSolve;
  });

  // Keyboard shortcut: Cmd/Ctrl + Enter to solve
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isSolvingRef.current) {
          handleSolveRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  let currentSnapshot: string | null = null;
  try {
    currentSnapshot = JSON.stringify(buildRequest());
  } catch {
    currentSnapshot = null;
  }
  const isStale = Boolean(result && lastSolvedSnapshot && currentSnapshot && lastSolvedSnapshot !== currentSnapshot);

  return (
    <div className="app-root">
      {/* Frosted Glass Header */}
      <Header
        apiUrl={apiUrl}
        onApiUrlChange={handleApiUrlChange}
        accessKey={accessKey}
        onAccessKeyChange={handleAccessKeyChange}
        anthropicKey={anthropicKey}
        onAnthropicKeyChange={handleAnthropicKeyChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        onSelectSample={handleSelectSample}
      />

      {/* Main Content Area */}
      <main className="app-main">
        {/* Error Alert (near input, dismissible) */}
        {error && (
          <ErrorAlert
            error={error}
            onDismiss={() => setError(null)}
            onRetry={handleSolve}
          />
        )}

        {/* Input Card */}
        <InputCard
          title={title}
          onTitleChange={setTitle}
          mode={mode}
          onModeChange={setMode}
          timeMode={timeMode}
          onTimeModeChange={setTimeMode}
          activities={activities}
          onActivitiesChange={setActivities}
          roundTe={roundTe}
          onRoundTeChange={setRoundTe}
          variancePolicy={variancePolicy}
          onVariancePolicyChange={setVariancePolicy}
          targetTime={targetTime}
          onTargetTimeChange={setTargetTime}
          targetDelta={targetDelta}
          onTargetDeltaChange={setTargetDelta}
          targetProbability={targetProbability}
          onTargetProbabilityChange={setTargetProbability}
          renumber={renumber}
          onRenumberChange={setRenumber}
          danglingPolicy={danglingPolicy}
          onDanglingPolicyChange={setDanglingPolicy}
          strictEstimates={strictEstimates}
          onStrictEstimatesChange={setStrictEstimates}
          crashTarget={crashTarget}
          onCrashTargetChange={setCrashTarget}
          onSolve={handleSolve}
          onExtractImage={handleExtractImage}
          onExtractAndSolveImage={handleExtractAndSolveImage}
          isSolving={isSolving}
          isExtracting={isExtracting}
          hasServerVisionKey={hasServerVisionKey}
          verifyNotes={verifyNotes}
          onDismissVerifyNotes={() => setVerifyNotes(null)}
          offendingActivityNames={offendingActivityNames}
        />

        {/* Friendly empty-results hint on first load */}
        {!result && !isSolving && !error && (
          <div className="empty-results-hint">
            <span>
              Ready to compute. Click <strong style={{ color: 'var(--text-primary)' }}>Solve Network</strong> or press{' '}
              <kbd className="empty-results-kbd">⌘ / Ctrl + ↵</kbd>
            </span>
          </div>
        )}

        {/* Multi-part Loading Skeleton during solve */}
        {isSolving && !result && (
          <div className="results-loading-skeleton" role="status" aria-label="Calculating CPM/PERT solution...">
            <div className="skeleton-tiles-row">
              <div className="skeleton skeleton-hero-tile" />
              <div className="skeleton skeleton-tile" />
              <div className="skeleton skeleton-tile" />
              <div className="skeleton skeleton-tile" />
            </div>
            <div className="skeleton skeleton-diagram-block" />
            <div className="skeleton-table-rows">
              <div className="skeleton skeleton-table-row" style={{ width: '100%' }} />
              <div className="skeleton skeleton-table-row" style={{ width: '88%' }} />
              <div className="skeleton skeleton-table-row" style={{ width: '94%' }} />
            </div>
          </div>
        )}

        {/* Results Section */}
        {result && (
          <section id="results-section">
            {isStale && (
              <div className="stale-banner-wrapper">
                <div className="stale-results-banner">
                  <span className="stale-banner-text">
                    Inputs were modified after solving. Displayed results may be out of date.
                  </span>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSolve}
                    style={{ fontSize: 'var(--text-xs)', padding: '6px 14px', minHeight: '30px' }}
                  >
                    Update Results (⌘↵)
                  </button>
                </div>
              </div>
            )}
            <ResultsView response={result} />
          </section>
        )}
      </main>

      {/* Useful Apple-Style Footer */}
      <footer className="app-footer">
        <div className="footer-left">
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>CPM / PERT Arrow Solver</span>
          <span>v1.0.0</span>
          <span className="footer-status-indicator">
            <span className={`footer-dot ${isBackendHealthy ? '' : 'is-offline'}`} />
            {isBackendHealthy ? 'Backend connected (:8000)' : 'Backend offline'}
          </span>
        </div>
        <div className="footer-right">
          <span>Activity-on-Arrow (AOA) Method</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
