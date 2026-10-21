import React, { useState, useMemo } from 'react';
import type { ScheduledActivity } from '../types/cpm';
import { CopyIcon, CheckIcon } from './Icons';
import './ActivityTable.css';

interface ActivityTableProps {
  activities: ScheduledActivity[];
  timed: boolean;
}

type SortField =
  | 'name'
  | 'i'
  | 'j'
  | 'duration'
  | 'ES'
  | 'EF'
  | 'LS'
  | 'LF'
  | 'total_float'
  | 'free_float'
  | 'interfering_float'
  | 'critical'
  | 'te_raw'
  | 'variance';

export const ActivityTable: React.FC<ActivityTableProps> = ({ activities, timed }) => {
  const [sortField, setSortField] = useState<SortField>('i');
  const [sortAsc, setSortAsc] = useState(true);
  const [copied, setCopied] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'critical' | 'real'>('all');

  const hasPert = useMemo(
    () => activities.some((a) => a.optimistic !== undefined || a.te_raw !== undefined),
    [activities]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (filterMode === 'critical') return a.critical && !a.dummy;
      if (filterMode === 'real') return !a.dummy;
      return true;
    });
  }, [activities, filterMode]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: any = a[sortField];
      let vb: any = b[sortField];

      if (va === undefined || va === null) va = -Infinity;
      if (vb === undefined || vb === null) vb = -Infinity;

      if (typeof va === 'string' && typeof vb === 'string') {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
    });
  }, [filtered, sortField, sortAsc]);

  const copyAsTSV = async () => {
    const headers = [
      'Activity',
      'Dummy',
      'Description',
      'Start (i)',
      'End (j)',
      'Duration',
      ...(timed ? ['ES', 'EF', 'LS', 'LF', 'Total Float', 'Free Float', 'Interfering Float', 'Critical'] : []),
      ...(hasPert ? ['a (Opt)', 'm (Likely)', 'b (Pess)', 'Te (Raw)', 'Variance'] : []),
    ];

    const rows = sorted.map((a) => [
      a.name,
      a.dummy ? 'Yes' : 'No',
      a.description || '',
      a.i,
      a.j,
      a.duration ?? '',
      ...(timed
        ? [
            a.ES ?? '',
            a.EF ?? '',
            a.LS ?? '',
            a.LF ?? '',
            a.total_float ?? '',
            a.free_float ?? '',
            a.interfering_float ?? '',
            a.critical ? 'YES' : 'NO',
          ]
        : []),
      ...(hasPert
        ? [
            a.optimistic ?? '',
            a.most_likely ?? '',
            a.pessimistic ?? '',
            a.te_raw ?? '',
            a.variance ?? '',
          ]
        : []),
    ]);

    const tsvContent = [headers.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
    try {
      await navigator.clipboard.writeText(tsvContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy TSV:', err);
    }
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return <span className="sort-arrow">{sortAsc ? '▲' : '▼'}</span>;
  };

  return (
    <div className="activity-table-card" id="table-section">
      <div className="activity-table-header">
        <div>
          <h3 className="activity-table-title">Activity Schedule</h3>
        </div>

        <div className="activity-table-actions">
          {/* Filter segment */}
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-button ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All ({activities.length})
            </button>
            <button
              type="button"
              className={`segmented-button ${filterMode === 'real' ? 'active' : ''}`}
              onClick={() => setFilterMode('real')}
            >
              No Dummies
            </button>
            {timed && (
              <button
                type="button"
                className={`segmented-button ${filterMode === 'critical' ? 'active' : ''}`}
                onClick={() => setFilterMode('critical')}
              >
                Critical
              </button>
            )}
          </div>

          {/* Copy TSV button */}
          <button
            type="button"
            className="btn-secondary"
            onClick={copyAsTSV}
            style={{ fontSize: 'var(--text-xs)', padding: '6px 12px', minHeight: '32px' }}
            title="Copy table as Tab-Separated Values for Excel or Sheets"
          >
            {copied ? (
              <>
                <CheckIcon size={14} style={{ color: 'var(--success)' }} />
                <span>Copied TSV</span>
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                <span>Copy TSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="table-scroll-container">
        <table className="schedule-data-table">
          <thead>
            <tr>
              <th
                className="sortable-th sticky-col-first"
                onClick={() => handleSort('name')}
              >
                Activity {renderSortIndicator('name')}
              </th>
              <th className="sortable-th" onClick={() => handleSort('i')}>
                i → j {renderSortIndicator('i')}
              </th>
              <th className="sortable-th" onClick={() => handleSort('duration')}>
                Duration {renderSortIndicator('duration')}
              </th>
              {timed && (
                <>
                  <th className="sortable-th" onClick={() => handleSort('ES')}>
                    ES {renderSortIndicator('ES')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('EF')}>
                    EF {renderSortIndicator('EF')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('LS')}>
                    LS {renderSortIndicator('LS')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('LF')}>
                    LF {renderSortIndicator('LF')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('total_float')}>
                    Total Float {renderSortIndicator('total_float')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('free_float')}>
                    Free Float {renderSortIndicator('free_float')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('interfering_float')}>
                    Interfering {renderSortIndicator('interfering_float')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('critical')}>
                    Status {renderSortIndicator('critical')}
                  </th>
                </>
              )}
              {hasPert && (
                <>
                  <th>a (opt)</th>
                  <th>m (likely)</th>
                  <th>b (pess)</th>
                  <th className="sortable-th" onClick={() => handleSort('te_raw')}>
                    Te {renderSortIndicator('te_raw')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('variance')}>
                    σ² {renderSortIndicator('variance')}
                  </th>
                </>
              )}
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, idx) => {
              const rowClass = a.dummy ? 'row-dummy' : a.critical ? 'row-critical' : '';
              return (
                <tr key={`${a.name}-${a.i}-${a.j}-${idx}`} className={rowClass}>
                  <td className="sticky-col-first" style={{ fontWeight: 600 }}>
                    {a.name}
                    {a.dummy && (
                      <span className="badge badge-neutral" style={{ marginLeft: '6px', fontSize: '10px' }}>
                        dummy
                      </span>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    {a.i} → {a.j}
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.duration ?? '–'}</td>
                  {timed && (
                    <>
                      <td>{a.ES ?? '–'}</td>
                      <td>{a.EF ?? '–'}</td>
                      <td>{a.LS ?? '–'}</td>
                      <td>{a.LF ?? '–'}</td>
                      <td
                        style={{
                          fontWeight: a.total_float === 0 ? 700 : 400,
                          color: a.total_float === 0 ? 'var(--critical)' : undefined,
                        }}
                      >
                        {a.total_float ?? '–'}
                      </td>
                      <td>{a.free_float ?? '–'}</td>
                      <td>{a.interfering_float ?? '–'}</td>
                      <td>
                        {a.critical ? (
                          <span className="badge badge-critical">Critical</span>
                        ) : (
                          <span className="badge badge-neutral">Non-critical</span>
                        )}
                      </td>
                    </>
                  )}
                  {hasPert && (
                    <>
                      <td>{a.optimistic ?? '–'}</td>
                      <td>{a.most_likely ?? '–'}</td>
                      <td>{a.pessimistic ?? '–'}</td>
                      <td>{a.te_raw ?? '–'}</td>
                      <td>{a.variance ?? '–'}</td>
                    </>
                  )}
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {a.description || '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
