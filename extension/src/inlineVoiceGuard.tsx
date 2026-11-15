import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceGuard } from './VoiceGuardReview';
import type { Scan } from './core';
export function mountVoiceGuard(
  container: HTMLElement,
  text: string,
  result: Scan,
  initial: boolean[],
  changed: (values: boolean[]) => void,
  insert: (values: boolean[]) => void,
  cancel: () => void,
  scan: () => void,
  applyCurrent?: (index: number) => void,
) {
  function Review() {
    const [accepted, setAccepted] = useState(initial),
      [approved, setApproved] = useState(false),
      [confirm, setConfirm] = useState(false);
    return (
      <>
        <VoiceGuard
          text={text}
          result={result}
          accepted={accepted}
          onChange={(values) => {
            setAccepted(values);
            changed(values);
            setApproved(false);
            setConfirm(false);
          }}
          onApproved={setApproved}
          onCancel={cancel}
          onScan={scan}
          onApplyCurrent={applyCurrent}
          advancedActions={
            <div>
              <button
                disabled={!approved || !result.safe_to_submit}
                onClick={() => setConfirm(true)}
              >
                Insert reviewed changes
              </button>
              {confirm && (
                <div role="group" aria-label="Confirm insertion">
                  <p>This website can read inserted text. Nothing will be submitted.</p>
                  <button
                    onClick={() => {
                      if (approved) insert(accepted);
                    }}
                  >
                    Confirm insert
                  </button>
                  <button onClick={() => setConfirm(false)}>Go back</button>
                </div>
              )}
            </div>
          }
        />
      </>
    );
  }
  const root = createRoot(container);
  root.render(<Review />);
  return () => root.unmount();
}
