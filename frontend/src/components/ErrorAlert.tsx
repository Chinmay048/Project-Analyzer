import React from 'react';
import type { APIErrorDetail } from '../types/cpm';
import { WarningIcon, RefreshIcon, CrossIcon } from './Icons';
import './ErrorAlert.css';

interface ErrorAlertProps {
  error: APIErrorDetail;
  onDismiss: () => void;
  onRetry?: () => void;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  error,
  onDismiss,
  onRetry,
}) => {
  let friendlyTitle = 'Unable to Solve Network';
  let friendlyHelp: React.ReactNode = null;

  switch (error.code) {
    case 'cycle':
      friendlyTitle = 'Network Cycle Detected';
      if (error.details && Array.isArray(error.details.cycle)) {
        const nodes: string[] = (error.details.cycle as unknown[]).map(String);
        friendlyHelp = (
          <div>
            The activities form a circular loop. In project networks, all activities must flow forward without circular dependencies:
            <div className="cycle-chips-container" role="list" aria-label="Cycle Path">
              {nodes.map((node: string, i: number) => (
                <React.Fragment key={`${node}-${i}`}>
                  <span className="mono-chip" role="listitem">{node}</span>
                  {i < nodes.length - 1 && <span className="cycle-arrow" aria-hidden="true">→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      }
      break;
    case 'unknown_predecessor':
      friendlyTitle = 'Unknown Predecessor';
      friendlyHelp = 'An activity lists a predecessor that does not exist in the table. Please verify activity names.';
      break;
    case 'duplicate_activity':
      friendlyTitle = 'Duplicate Activity Name';
      friendlyHelp = 'Multiple activities share the same name or node pair. Each activity arrow must have a unique identifier.';
      break;
    case 'missing_time':
      friendlyTitle = 'Missing Duration / Estimates';
      friendlyHelp = 'Please provide duration or 3-point estimates (a, m, b) for all activities, or use Diagram-only mode.';
      break;
    case 'missing_api_key':
    case 'invalid_api_key':
      friendlyTitle = 'Vision API Key Required';
      friendlyHelp = (
        <div>
          {error.message || 'Please add your GEMINI_API_KEY to the .env file or provide an Anthropic key in Settings.'}
        </div>
      );
      break;
    case 'bad_image':
      friendlyTitle = 'Unsupported Image Format';
      friendlyHelp = 'Please upload a PNG, JPEG, WEBP, or GIF image.';
      break;
    case 'file_too_large':
      friendlyTitle = 'File Too Large';
      friendlyHelp = 'The uploaded image exceeds the 5 MB limit. Please compress or crop the image.';
      break;
    case 'vision_unreachable':
      friendlyTitle = 'Vision API Unreachable';
      friendlyHelp = 'Could not contact the Vision service. Check your internet connection or proxy.';
      break;
    case 'forbidden':
      friendlyTitle = 'Access Denied';
      friendlyHelp = 'Backend access key (X-Access-Key) is missing or invalid. Check Settings.';
      break;
    case 'timeout':
      friendlyTitle = 'Request Timed Out';
      friendlyHelp = 'The operation took longer than 90 seconds. Try cropping the image to just the table.';
      break;
    default:
      friendlyTitle = error.code ? `Error: ${error.code}` : 'Error';
      friendlyHelp = error.details ? (
        <pre style={{ fontSize: 'var(--text-xs)', marginTop: '4px', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
          {typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2)}
        </pre>
      ) : null;
  }

  return (
    <div className="error-alert-card" role="alert" aria-live="assertive">
      <div className="error-icon-wrapper">
        <WarningIcon size={18} />
      </div>

      <div className="error-body">
        <div className="error-header">
          <h4 className="error-title">{friendlyTitle}</h4>
          <button
            type="button"
            className="btn-icon"
            style={{ width: '26px', height: '26px' }}
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <CrossIcon size={14} />
          </button>
        </div>

        <p className="error-message">{error.message}</p>

        {friendlyHelp && <div className="error-help">{friendlyHelp}</div>}

        <div className="error-actions">
          {onRetry && (
            <button type="button" className="btn-secondary btn-retry" onClick={onRetry}>
              <RefreshIcon size={13} />
              <span>Retry</span>
            </button>
          )}
          <button type="button" className="btn-quiet btn-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
