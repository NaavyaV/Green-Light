/** Full-page message shown in engine mode before the first simulated second arrives. */
export function EngineStatusScreen({ connection, onRestart }) {
  const offline = connection.status === 'offline';
  return (
    <div className="engine-screen">
      <div className="panel engine-card" role="status" aria-live="polite">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
        <h1>{offline ? 'C++ engine offline' : 'Connecting to the C++ engine…'}</h1>
        {offline ? <OfflineHelp connection={connection} onRestart={onRestart} /> : <p>Waiting for the first simulated second.</p>}
      </div>
    </div>
  );
}

/** Banner over the dashboard when the engine stops after data has arrived. */
export function EngineBanner({ connection, onRestart }) {
  if (connection.status !== 'offline') return null;
  return (
    <div className="engine-banner" role="alert">
      <b>Engine offline.</b> Showing the last data received.
      <OfflineHelp connection={connection} onRestart={onRestart} inline />
    </div>
  );
}

function OfflineHelp({ connection, onRestart, inline }) {
  const Tag = inline ? 'span' : 'p';
  return (
    <>
      {connection.error && <Tag className="engine-error">{connection.error}</Tag>}
      {connection.reachable ? (
        // The bridge is up and only the engine stopped: start it again from here.
        <button type="button" className="btn primary" onClick={onRestart}>Restart engine</button>
      ) : (
        <Tag>
          Start the engine and dashboard together from <code>frontend/</code> with <code>npm run dev:live</code>
          {' '}(build the engine into <code>build/</code> first).
        </Tag>
      )}
    </>
  );
}
