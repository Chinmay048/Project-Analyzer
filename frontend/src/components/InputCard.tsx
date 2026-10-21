import React, { useState, useRef, useEffect, useCallback } from 'react';
import type {
  ActivityIn,
  InputMode,
  TimeMode,
  VariancePolicy,
  DanglingPolicy,
} from '../types/cpm';
import {
  TableIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  ChevronDownIcon,
  SparklesIcon,
  CrossIcon,
} from './Icons';
import './InputCard.css';

interface InputCardProps {
  // Current problem state
  title: string;
  onTitleChange: (title: string) => void;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  timeMode: TimeMode;
  onTimeModeChange: (timeMode: TimeMode) => void;
  activities: ActivityIn[];
  onActivitiesChange: (acts: ActivityIn[]) => void;

  // Options
  roundTe: boolean;
  onRoundTeChange: (round: boolean) => void;
  variancePolicy: VariancePolicy;
  onVariancePolicyChange: (policy: VariancePolicy) => void;
  targetTime: string;
  onTargetTimeChange: (val: string) => void;
  targetDelta: string;
  onTargetDeltaChange: (val: string) => void;
  targetProbability: string;
  onTargetProbabilityChange: (val: string) => void;
  renumber: string; // 'auto' | 'true' | 'false'
  onRenumberChange: (val: string) => void;
  danglingPolicy: DanglingPolicy;
  onDanglingPolicyChange: (val: DanglingPolicy) => void;
  strictEstimates: boolean;
  onStrictEstimatesChange: (val: boolean) => void;
  crashTarget: string;
  onCrashTargetChange: (val: string) => void;

  // Actions
  onSolve: () => void;
  onExtractImage: (file: File) => void;
  onExtractAndSolveImage: (file: File) => void;
  isSolving: boolean;
  isExtracting: boolean;

  hasServerVisionKey: boolean;

  // Verification banner notes from extraction
  verifyNotes: string[] | null;
  onDismissVerifyNotes: () => void;

  // Highlighted activities (e.g. from error)
  offendingActivityNames?: string[];
}

export const InputCard: React.FC<InputCardProps> = ({
  title,
  onTitleChange,
  mode,
  onModeChange,
  timeMode,
  onTimeModeChange,
  activities,
  onActivitiesChange,
  roundTe,
  onRoundTeChange,
  variancePolicy,
  onVariancePolicyChange,
  targetTime,
  onTargetTimeChange,
  targetDelta,
  onTargetDeltaChange,
  targetProbability,
  onTargetProbabilityChange,
  renumber,
  onRenumberChange,
  danglingPolicy,
  onDanglingPolicyChange,
  strictEstimates,
  onStrictEstimatesChange,
  crashTarget,
  onCrashTargetChange,
  onSolve,
  onExtractImage,
  onExtractAndSolveImage,
  isSolving,
  isExtracting,
  verifyNotes,
  onDismissVerifyNotes,
  offendingActivityNames = [],
}) => {
  const [activeTab, setActiveTab] = useState<'table' | 'image'>('table');
  const [showOptions, setShowOptions] = useState(false);
  const [showCrashingColumns, setShowCrashingColumns] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pastedRawText, setPastedRawText] = useState('');

  // Image upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clearConfirmRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Close clear confirm when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (clearConfirmRef.current && !clearConfirmRef.current.contains(e.target as Node)) {
        setShowClearConfirm(false);
      }
    };
    if (showClearConfirm) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showClearConfirm]);

  // Scroll first offending row into view if any
  useEffect(() => {
    if (offendingActivityNames.length > 0 && tableRef.current) {
      const firstOffending = tableRef.current.querySelector('.row-offending');
      if (firstOffending) {
        firstOffending.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [offendingActivityNames]);

  // Add activity row
  const addRow = () => {
    const nextChar = String.fromCharCode(65 + (activities.length % 26));
    const nextName = activities.some((a) => a.name === nextChar)
      ? `${nextChar}${Math.floor(activities.length / 26) + 1}`
      : nextChar;

    const newAct: ActivityIn = {
      id: `act-${Date.now()}-${Math.random()}`,
      name: nextName,
      description: '',
      predecessors: mode === 'predecessors' ? (activities.length > 0 ? [String(activities[activities.length - 1].name)] : []) : undefined,
      start_node: mode === 'nodes' ? (activities.length > 0 ? (activities[activities.length - 1].end_node ?? activities.length) : 1) : undefined,
      end_node: mode === 'nodes' ? (activities.length > 0 ? (activities[activities.length - 1].end_node ? Number(activities[activities.length - 1].end_node) + 1 : activities.length + 1) : 2) : undefined,
      duration: timeMode === 'duration' ? 3 : null,
      optimistic: timeMode === 'pert' ? 2 : null,
      most_likely: timeMode === 'pert' ? 3 : null,
      pessimistic: timeMode === 'pert' ? 5 : null,
    };
    onActivitiesChange([...activities, newAct]);
  };

  // Delete row
  const deleteRow = (index: number) => {
    const updated = activities.filter((_, i) => i !== index);
    onActivitiesChange(updated);
  };

  // Clear all rows
  const handleConfirmClear = () => {
    onActivitiesChange([]);
    setShowClearConfirm(false);
  };

  // Update a single cell
  const updateRow = (index: number, field: keyof ActivityIn, value: any) => {
    const updated = [...activities];
    updated[index] = { ...updated[index], [field]: value };
    onActivitiesChange(updated);
  };

  // Handle paste import
  const handleApplyPaste = () => {
    if (!pastedRawText.trim()) {
      setShowPasteModal(false);
      return;
    }

    const lines = pastedRawText.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsedActs: ActivityIn[] = [];

    lines.forEach((line, idx) => {
      const cells = line.includes('\t')
        ? line.split('\t').map((c) => c.trim())
        : line.split(',').map((c) => c.trim());

      if (cells.length === 0) return;

      const lower0 = cells[0].toLowerCase();
      const lower1 = (cells[1] || '').toLowerCase();
      const isHeader = idx === 0 && (
        (['activity', 'task', 'activity name'].includes(lower0) && ['predecessor', 'predecessors', 'pred', 'preds', 'duration', 'dur'].includes(lower1)) ||
        (['start', 'start_node', 'from', 'i'].includes(lower0) && ['end', 'end_node', 'to', 'j'].includes(lower1))
      );
      if (isHeader) return;

      if (mode === 'nodes') {
        const sNode = cells[0] !== undefined && !isNaN(Number(cells[0])) ? Number(cells[0]) : 1;
        const eNode = cells[1] !== undefined && !isNaN(Number(cells[1])) ? Number(cells[1]) : 2;
        parsedActs.push({
          id: `p-${idx}-${Date.now()}`,
          start_node: sNode,
          end_node: eNode,
          name: cells[2] || `A${idx + 1}`,
          duration: cells[3] !== undefined && cells[3] !== '' ? Number(cells[3].replace(',', '.')) : null,
          optimistic: cells[4] !== undefined && cells[4] !== '' ? Number(cells[4].replace(',', '.')) : null,
          most_likely: cells[5] !== undefined && cells[5] !== '' ? Number(cells[5].replace(',', '.')) : null,
          pessimistic: cells[6] !== undefined && cells[6] !== '' ? Number(cells[6].replace(',', '.')) : null,
        });
      } else {
        const rawPreds = cells[1] || '';
        const preds = rawPreds
          .split(/[,;]+/)
          .map((p: string) => p.trim())
          .filter(Boolean);

        parsedActs.push({
          id: `p-${idx}-${Date.now()}`,
          name: cells[0] || `A${idx + 1}`,
          predecessors: preds,
          duration: cells[2] !== undefined && cells[2] !== '' ? Number(cells[2].replace(',', '.')) : null,
          optimistic: cells[3] !== undefined && cells[3] !== '' ? Number(cells[3].replace(',', '.')) : null,
          most_likely: cells[4] !== undefined && cells[4] !== '' ? Number(cells[4].replace(',', '.')) : null,
          pessimistic: cells[5] !== undefined && cells[5] !== '' ? Number(cells[5].replace(',', '.')) : null,
        });
      }
    });

    if (parsedActs.length > 0) {
      onActivitiesChange(parsedActs);
    }
    setPastedRawText('');
    setShowPasteModal(false);
  };

  // Image file selection & preview handler
  const handleFileSelected = useCallback((file: File) => {
    let finalFile = file;
    if (!file.name || file.name === 'image.png' || file.name === 'blob') {
      const ext = file.type.split('/')[1] || 'png';
      finalFile = new File([file], `pasted_screenshot_${Date.now()}.${ext}`, { type: file.type });
    }
    setSelectedFile(finalFile);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(finalFile);
  }, []);

  // Image file drop handlers
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  // Clipboard paste handler
  const handleImagePaste = useCallback(
    (e: ClipboardEvent | React.ClipboardEvent) => {
      const clipboardData = 'clipboardData' in e ? e.clipboardData : null;
      if (!clipboardData) return;

      const items = clipboardData.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              e.preventDefault();
              setActiveTab('image');
              handleFileSelected(file);
              return;
            }
          }
        }
      }

      if (
        clipboardData.files &&
        clipboardData.files[0] &&
        clipboardData.files[0].type.startsWith('image/')
      ) {
        e.preventDefault();
        setActiveTab('image');
        handleFileSelected(clipboardData.files[0]);
      }
    },
    [handleFileSelected]
  );

  // Global window paste listener when outside form inputs
  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      handleImagePaste(e);
    };

    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [handleImagePaste]);

  return (
    <div className="apple-card input-card-container">
      {/* Top Header: Title & Tab Switcher */}
      <div className="input-header-row">
        <input
          type="text"
          className="project-title-input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Project Title"
          aria-label="Project Title"
        />

        <div className="segmented-control" role="tablist" aria-label="Input Method">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'table'}
            className={`segmented-button ${activeTab === 'table' ? 'active' : ''}`}
            onClick={() => setActiveTab('table')}
          >
            <TableIcon size={15} style={{ marginRight: '6px' }} />
            <span>Table Editor</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'image'}
            className={`segmented-button ${activeTab === 'image' ? 'active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            <PhotoIcon size={15} style={{ marginRight: '6px' }} />
            <span>Vision OCR</span>
          </button>
        </div>
      </div>

      {/* Verification notes checklist from extraction if present */}
      {verifyNotes && verifyNotes.length > 0 && (
        <div className="verify-notes-card" role="region" aria-label="OCR Verification Notes">
          <div className="verify-notes-header">
            <span className="verify-notes-title">Please Review Extracted Details</span>
            <button
              type="button"
              className="btn-icon"
              style={{ width: '24px', height: '24px' }}
              onClick={onDismissVerifyNotes}
              aria-label="Dismiss notes"
            >
              <CrossIcon size={12} />
            </button>
          </div>
          <ul className="verify-notes-list">
            {verifyNotes.map((note, idx) => (
              <li key={idx} className="verify-note-item">
                <span style={{ color: 'var(--warning-text)', fontWeight: 700 }}>•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ===================== TAB 1: TABLE EDITOR ===================== */}
      {activeTab === 'table' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Table Toolbar */}
          <div className="toolbar-container">
            <div className="toolbar-controls-group">
              {/* Network Mode */}
              <div className="segmented-control" aria-label="Network Dependency Mode">
                <button
                  type="button"
                  className={`segmented-button ${mode === 'predecessors' ? 'active' : ''}`}
                  onClick={() => onModeChange('predecessors')}
                >
                  Predecessors
                </button>
                <button
                  type="button"
                  className={`segmented-button ${mode === 'nodes' ? 'active' : ''}`}
                  onClick={() => onModeChange('nodes')}
                >
                  Events (i → j)
                </button>
              </div>

              {/* Time Mode */}
              <div className="segmented-control" aria-label="Activity Time Mode">
                <button
                  type="button"
                  className={`segmented-button ${timeMode === 'duration' ? 'active' : ''}`}
                  onClick={() => onTimeModeChange('duration')}
                >
                  Duration
                </button>
                <button
                  type="button"
                  className={`segmented-button ${timeMode === 'pert' ? 'active' : ''}`}
                  onClick={() => onTimeModeChange('pert')}
                >
                  PERT (a, m, b)
                </button>
              </div>
            </div>

            {/* Quick table actions */}
            <div className="toolbar-actions-group">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCrashingColumns(!showCrashingColumns)}
                style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', minHeight: '32px' }}
              >
                {showCrashingColumns ? 'Hide Crashing' : '+ Crashing Costs'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowPasteModal(true)}
                style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', minHeight: '32px' }}
                title="Paste tabular data from Excel or Google Sheets"
              >
                Paste
              </button>

              {/* Clear button with confirm popover */}
              <div style={{ position: 'relative' }} ref={clearConfirmRef}>
                <button
                  type="button"
                  className="btn-quiet-destructive"
                  onClick={() => setShowClearConfirm(!showClearConfirm)}
                  title="Clear all rows"
                >
                  Clear
                </button>

                {showClearConfirm && (
                  <div className="clear-confirm-popover" role="dialog" aria-label="Confirm Clear">
                    <div className="clear-confirm-title">
                      Clear all {activities.length} activities?
                    </div>
                    <div className="clear-confirm-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: '12px', padding: '4px 10px', minHeight: '26px' }}
                        onClick={() => setShowClearConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ fontSize: '12px', padding: '4px 10px', minHeight: '26px', background: 'var(--critical)' }}
                        onClick={handleConfirmClear}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Desktop/Tablet Table (>= 640px) */}
          <div className="input-table-wrapper" ref={tableRef}>
            <table className="input-table">
              <thead>
                <tr>
                  <th style={{ width: '42px', textAlign: 'center' }}>#</th>
                  <th style={{ width: mode === 'nodes' ? '120px' : '100px' }}>
                    {mode === 'nodes' ? 'Name' : 'Activity'}
                  </th>
                  {mode === 'predecessors' ? (
                    <th style={{ minWidth: '150px' }}>Predecessors</th>
                  ) : (
                    <>
                      <th style={{ width: '85px' }}>From (i)</th>
                      <th style={{ width: '85px' }}>To (j)</th>
                    </>
                  )}

                  {timeMode === 'duration' ? (
                    <th style={{ width: '100px' }}>Duration</th>
                  ) : (
                    <>
                      <th style={{ width: '80px' }}>a (opt)</th>
                      <th style={{ width: '80px' }}>m (likely)</th>
                      <th style={{ width: '80px' }}>b (pess)</th>
                    </>
                  )}

                  {showCrashingColumns && (
                    <>
                      <th style={{ width: '90px' }}>Normal $</th>
                      <th style={{ width: '90px' }}>Crash $</th>
                      <th style={{ width: '90px' }}>Crash t</th>
                    </>
                  )}

                  <th>Description</th>
                  <th style={{ width: '42px', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {activities.map((act, index) => {
                  const isOffending = Boolean(act.name && offendingActivityNames.includes(String(act.name)));

                  return (
                    <tr key={act.id || index} className={isOffending ? 'row-offending' : ''}>
                      <td style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                        {index + 1}
                      </td>

                      <td>
                        <input
                          type="text"
                          className="row-input"
                          style={{ fontWeight: 600 }}
                          value={act.name ?? ''}
                          onChange={(e) => updateRow(index, 'name', e.target.value)}
                          placeholder={`A${index + 1}`}
                          aria-label={`Activity ${index + 1} Name`}
                        />
                      </td>

                      {mode === 'predecessors' ? (
                        <td>
                          <input
                            type="text"
                            className="row-input row-input-mono"
                            value={Array.isArray(act.predecessors) ? act.predecessors.join(', ') : act.predecessors ?? ''}
                            onChange={(e) => updateRow(index, 'predecessors', e.target.value)}
                            placeholder="e.g. A, B"
                            aria-label={`Activity ${act.name || index + 1} Predecessors`}
                          />
                        </td>
                      ) : (
                        <>
                          <td>
                            <input
                              type="number"
                              className="row-input row-input-mono"
                              value={act.start_node ?? ''}
                              onChange={(e) => updateRow(index, 'start_node', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="1"
                              aria-label={`Activity ${act.name || index + 1} Start Node`}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="row-input row-input-mono"
                              value={act.end_node ?? ''}
                              onChange={(e) => updateRow(index, 'end_node', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="2"
                              aria-label={`Activity ${act.name || index + 1} End Node`}
                            />
                          </td>
                        </>
                      )}

                      {timeMode === 'duration' ? (
                        <td>
                          <input
                            type="number"
                            step="any"
                            className="row-input tabular"
                            style={{ fontWeight: 600 }}
                            value={act.duration ?? ''}
                            onChange={(e) => updateRow(index, 'duration', e.target.value === '' ? null : Number(e.target.value))}
                            placeholder="0"
                            aria-label={`Activity ${act.name || index + 1} Duration`}
                          />
                        </td>
                      ) : (
                        <>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.optimistic ?? ''}
                              onChange={(e) => updateRow(index, 'optimistic', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="a"
                              aria-label={`Activity ${act.name || index + 1} Optimistic time`}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.most_likely ?? ''}
                              onChange={(e) => updateRow(index, 'most_likely', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="m"
                              aria-label={`Activity ${act.name || index + 1} Most likely time`}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.pessimistic ?? ''}
                              onChange={(e) => updateRow(index, 'pessimistic', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="b"
                              aria-label={`Activity ${act.name || index + 1} Pessimistic time`}
                            />
                          </td>
                        </>
                      )}

                      {showCrashingColumns && (
                        <>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.normal_cost ?? ''}
                              onChange={(e) => updateRow(index, 'normal_cost', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="Normal $"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.crash_cost ?? ''}
                              onChange={(e) => updateRow(index, 'crash_cost', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="Crash $"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className="row-input tabular"
                              value={act.crash_time ?? ''}
                              onChange={(e) => updateRow(index, 'crash_time', e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="Crash t"
                            />
                          </td>
                        </>
                      )}

                      <td>
                        <input
                          type="text"
                          className="row-input"
                          value={act.description ?? ''}
                          onChange={(e) => updateRow(index, 'description', e.target.value)}
                          placeholder="Notes"
                        />
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => deleteRow(index)}
                          style={{ width: '28px', height: '28px', color: 'var(--text-tertiary)' }}
                          title={`Delete activity ${act.name}`}
                          aria-label={`Delete activity ${act.name}`}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View (< 640px) */}
          <div className="mobile-cards-list">
            {activities.map((act, index) => {
              const isOffending = Boolean(act.name && offendingActivityNames.includes(String(act.name)));

              return (
                <div key={act.id || index} className={`mobile-act-card ${isOffending ? 'row-offending' : ''}`}>
                  <div className="mobile-card-top-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-tertiary)' }}>
                        #{index + 1}
                      </span>
                      <input
                        type="text"
                        className="mobile-row-input"
                        style={{ fontWeight: 700, width: '90px' }}
                        value={act.name ?? ''}
                        onChange={(e) => updateRow(index, 'name', e.target.value)}
                        placeholder="Name"
                        aria-label={`Activity ${index + 1} Name`}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {timeMode === 'duration' && (
                        <input
                          type="number"
                          step="any"
                          className="mobile-row-input tabular"
                          style={{ fontWeight: 600, width: '100px' }}
                          value={act.duration ?? ''}
                          onChange={(e) => updateRow(index, 'duration', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="Duration"
                          aria-label={`Activity ${act.name} Duration`}
                        />
                      )}
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => deleteRow(index)}
                        style={{ width: '36px', height: '36px', color: 'var(--critical)' }}
                        aria-label={`Delete activity ${act.name}`}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Predecessors / Nodes Line */}
                  {mode === 'predecessors' ? (
                    <div>
                      <div className="mobile-field-label">Predecessors</div>
                      <input
                        type="text"
                        className="mobile-row-input row-input-mono"
                        value={Array.isArray(act.predecessors) ? act.predecessors.join(', ') : act.predecessors ?? ''}
                        onChange={(e) => updateRow(index, 'predecessors', e.target.value)}
                        placeholder="e.g. A, B (or leave empty)"
                      />
                    </div>
                  ) : (
                    <div className="mobile-field-row">
                      <div>
                        <div className="mobile-field-label">From Node (i)</div>
                        <input
                          type="number"
                          className="mobile-row-input row-input-mono"
                          value={act.start_node ?? ''}
                          onChange={(e) => updateRow(index, 'start_node', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="1"
                        />
                      </div>
                      <div>
                        <div className="mobile-field-label">To Node (j)</div>
                        <input
                          type="number"
                          className="mobile-row-input row-input-mono"
                          value={act.end_node ?? ''}
                          onChange={(e) => updateRow(index, 'end_node', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="2"
                        />
                      </div>
                    </div>
                  )}

                  {/* PERT estimates in mobile */}
                  {timeMode === 'pert' && (
                    <div className="mobile-field-row">
                      <div>
                        <div className="mobile-field-label">a (optimistic)</div>
                        <input
                          type="number"
                          step="any"
                          className="mobile-row-input tabular"
                          value={act.optimistic ?? ''}
                          onChange={(e) => updateRow(index, 'optimistic', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="a"
                        />
                      </div>
                      <div>
                        <div className="mobile-field-label">m (likely)</div>
                        <input
                          type="number"
                          step="any"
                          className="mobile-row-input tabular"
                          value={act.most_likely ?? ''}
                          onChange={(e) => updateRow(index, 'most_likely', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="m"
                        />
                      </div>
                      <div>
                        <div className="mobile-field-label">b (pessimistic)</div>
                        <input
                          type="number"
                          step="any"
                          className="mobile-row-input tabular"
                          value={act.pessimistic ?? ''}
                          onChange={(e) => updateRow(index, 'pessimistic', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="b"
                        />
                      </div>
                    </div>
                  )}

                  {/* Description note */}
                  <div>
                    <input
                      type="text"
                      className="mobile-row-input"
                      value={act.description ?? ''}
                      onChange={(e) => updateRow(index, 'description', e.target.value)}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Row Button Row */}
          <div className="add-activity-row">
            <button
              type="button"
              className="btn-quiet add-activity-btn"
              onClick={addRow}
            >
              <PlusIcon size={16} />
              <span>Add Activity</span>
            </button>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: IMAGE VISION OCR ===================== */}
      {activeTab === 'image' && (
        <div className="vision-tab-container">
          <div
            className={`dropzone ${isDragOver ? 'active' : ''}`}
            tabIndex={0}
            role="button"
            aria-label="Upload or paste problem screenshot"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleFileDrop}
            onPaste={handleImagePaste}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelected(e.target.files[0]);
                }
              }}
            />

            {imagePreview ? (
              <div className="vision-preview-card" onClick={(e) => e.stopPropagation()}>
                <img src={imagePreview} alt="Uploaded table preview" className="vision-preview-img" />
                <div className="vision-preview-details">
                  <div className="vision-filename">{selectedFile?.name}</div>
                  <div className="vision-filesize">
                    {((selectedFile?.size || 0) / 1024).toFixed(1)} KB • Image Loaded
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '11px', padding: '3px 10px', minHeight: '26px' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="btn-quiet-destructive"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => {
                        setSelectedFile(null);
                        setImagePreview(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <PhotoIcon size={32} style={{ color: 'var(--accent)', marginBottom: '8px' }} />
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Drag & drop textbook problem table or click to browse
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  Supported formats: PNG, JPG, WEBP, GIF (≤ 5 MB)
                </div>
                <div className="dropzone-paste-badge">
                  <span>Press <kbd>Ctrl+V</kbd> or <kbd>⌘V</kbd> to paste screenshot</span>
                </div>
              </>
            )}
          </div>

          {/* Indeterminate progress bar during vision extraction */}
          {isExtracting && (
            <div className="vision-progress-track">
              <div className="vision-progress-bar" />
            </div>
          )}

          {/* Vision Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={!selectedFile || isExtracting || isSolving}
              onClick={() => selectedFile && onExtractImage(selectedFile)}
              style={{ flex: 1, minHeight: '44px', fontWeight: 600 }}
            >
              {isExtracting ? 'Extracting Activities...' : 'Extract to Table'}
            </button>

            <button
              type="button"
              className="btn-primary"
              disabled={!selectedFile || isExtracting || isSolving}
              onClick={() => selectedFile && onExtractAndSolveImage(selectedFile)}
              style={{ flex: 1, minHeight: '44px' }}
            >
              <SparklesIcon size={16} />
              <span>{isExtracting ? 'Analyzing...' : 'Extract & Solve'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ===================== ADVANCED OPTIONS ACCORDION ===================== */}
      <div>
        <div
          className="options-toggle-header"
          onClick={() => setShowOptions(!showOptions)}
          role="button"
          aria-expanded={showOptions}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowOptions(!showOptions);
            }
          }}
        >
          <div className="options-toggle-title">
            <ChevronDownIcon size={16} className={`options-chevron ${showOptions ? 'open' : ''}`} />
            <span>Advanced Calculation Options & Targets</span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {roundTe || targetTime || targetDelta || targetProbability || crashTarget ? 'Customized' : 'Defaults'}
          </span>
        </div>

        <div className={`options-accordion-grid ${showOptions ? 'open' : ''}`}>
          <div className="options-accordion-content">
            <div className="options-inner-grid">
              {/* Round Te Option */}
              <div className="option-field">
                <span className="option-label">PERT Duration Rounding</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', height: '38px', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={roundTe}
                    onChange={(e) => onRoundTeChange(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                  />
                  <span>Round Te to whole numbers</span>
                </label>
              </div>

              {/* Variance Policy */}
              <div className="option-field">
                <label htmlFor="variance-policy-select" className="option-label">
                  Variance Tie-Breaker
                </label>
                <select
                  id="variance-policy-select"
                  className="input-select"
                  value={variancePolicy}
                  onChange={(e) => onVariancePolicyChange(e.target.value as VariancePolicy)}
                >
                  <option value="max">Maximum variance (standard)</option>
                  <option value="min">Minimum variance</option>
                  <option value="first">First critical path</option>
                </select>
              </div>

              {/* Target Time */}
              <div className="option-field">
                <label htmlFor="target-time-input" className="option-label">
                  Target Time (T)
                </label>
                <input
                  id="target-time-input"
                  type="number"
                  step="any"
                  className="input-text tabular"
                  value={targetTime}
                  onChange={(e) => onTargetTimeChange(e.target.value)}
                  placeholder="e.g. 24"
                />
              </div>

              {/* Target Delta */}
              <div className="option-field">
                <label htmlFor="target-delta-input" className="option-label">
                  Target Delta (± days)
                </label>
                <input
                  id="target-delta-input"
                  type="number"
                  step="any"
                  className="input-text tabular"
                  value={targetDelta}
                  onChange={(e) => onTargetDeltaChange(e.target.value)}
                  placeholder="e.g. -4 (4 days earlier)"
                />
              </div>

              {/* Confidence Probability */}
              <div className="option-field">
                <label htmlFor="target-prob-input" className="option-label">
                  Confidence Level (%)
                </label>
                <input
                  id="target-prob-input"
                  type="number"
                  step="any"
                  className="input-text tabular"
                  value={targetProbability}
                  onChange={(e) => onTargetProbabilityChange(e.target.value)}
                  placeholder="e.g. 95 (or 0.95)"
                />
              </div>

              {/* Crashing Target */}
              <div className="option-field">
                <label htmlFor="crash-target-input" className="option-label">
                  Crash Project Target
                </label>
                <input
                  id="crash-target-input"
                  type="number"
                  step="any"
                  className="input-text tabular"
                  value={crashTarget}
                  onChange={(e) => onCrashTargetChange(e.target.value)}
                  placeholder="e.g. 18 days"
                />
              </div>

              {/* Fulkerson Renumbering */}
              <div className="option-field">
                <label htmlFor="renumber-select" className="option-label">
                  Fulkerson Renumbering
                </label>
                <select
                  id="renumber-select"
                  className="input-select"
                  value={renumber}
                  onChange={(e) => onRenumberChange(e.target.value)}
                >
                  <option value="auto">Auto (renumber in predecessors mode)</option>
                  <option value="true">Always renumber (i &lt; j)</option>
                  <option value="false">Keep input node numbers</option>
                </select>
              </div>

              {/* Dangling Policy */}
              <div className="option-field">
                <label htmlFor="dangling-policy-select" className="option-label">
                  Dangling Events Policy
                </label>
                <select
                  id="dangling-policy-select"
                  className="input-select"
                  value={danglingPolicy}
                  onChange={(e) => onDanglingPolicyChange(e.target.value as DanglingPolicy)}
                >
                  <option value="connect">Auto-connect to start/finish</option>
                  <option value="error">Strict error on disconnected nodes</option>
                </select>
              </div>

              {/* Strict Estimates */}
              <div className="option-field">
                <span className="option-label">Validation Strictness</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', height: '38px', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={strictEstimates}
                    onChange={(e) => onStrictEstimatesChange(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                  />
                  <span>Error if m outside [a, b]</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== BOTTOM SOLVE ACTION BAR ===================== */}
      <div className="solve-bar">
        <div className="solve-hint">
          <span>Keyboard shortcut:</span>
          <kbd className="keyboard-shortcut-tag">⌘ / Ctrl + Enter</kbd>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={onSolve}
          disabled={isSolving || activities.length === 0}
          style={{ minWidth: '180px' }}
        >
          {isSolving ? (
            <>
              <span className="status-indicator-dot status-dot-connecting" style={{ background: '#fff' }} />
              <span>Solving...</span>
            </>
          ) : (
            <>
              <PlayIcon size={16} />
              <span>Solve Network</span>
            </>
          )}
        </button>
      </div>

      {/* ===================== PASTE MODAL ===================== */}
      {showPasteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(8px)',
            zIndex: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'popoverReveal 160ms var(--ease-out)',
          }}
          onClick={() => setShowPasteModal(false)}
        >
          <div
            className="apple-card"
            style={{
              width: '100%',
              maxWidth: '540px',
              padding: '24px',
              boxShadow: 'var(--shadow-popover)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px' }}>
              Paste Table from Excel / CSV
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
              Copy rows from Excel or Google Sheets and paste them below. Expected format:<br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)' }}>
                {mode === 'predecessors' ? 'Activity [tab/comma] Predecessors [tab] Duration' : 'From [tab/comma] To [tab] Name [tab] Duration'}
              </code>
            </p>
            <textarea
              className="input-text"
              rows={8}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                resize: 'vertical',
                marginBottom: '18px',
              }}
              value={pastedRawText}
              onChange={(e) => setPastedRawText(e.target.value)}
              placeholder={mode === 'predecessors' ? "A\t-\t5\nB\tA\t6\nC\tA\t4" : "1\t2\tA\t5\n2\t3\tB\t6"}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowPasteModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleApplyPaste}
              >
                Apply & Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
