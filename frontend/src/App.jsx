import { useState } from 'react';
import { INTERSECTIONS } from './sim/constants.js';
import { DATA_SOURCE } from './config.js';
import { useSimulation } from './hooks/useSimulation.js';
import { useEngineFeed } from './hooks/useEngineFeed.js';
import { useTheme } from './hooks/useTheme.js';
import Header from './components/Header.jsx';
import KpiStrip from './components/KpiStrip.jsx';
import IntersectionPanel from './components/IntersectionPanel.jsx';
import SidePanel from './components/SidePanel.jsx';
import { EngineBanner, EngineStatusScreen } from './components/EngineStatus.jsx';

// DATA_SOURCE is a constant, so the same hook runs on every render (as React requires).
const useDataSource = DATA_SOURCE === 'engine' ? useEngineFeed : useSimulation;

export default function App() {
  const [isect, setIsect] = useState(0);
  const [scenario, setScenario] = useState(INTERSECTIONS[0].scenario);
  const [selected, setSelected] = useState(null);
  const { sim, view, running, speed, actions, onFrame, connection } = useDataSource(scenario);
  const theme = useTheme();

  // Engine mode has no data until the first simulated second arrives.
  if (!view) return <EngineStatusScreen connection={connection} onRestart={() => actions.restart()} />;

  const changeIntersection = (i) => {
    setIsect(i);
    setScenario(INTERSECTIONS[i].scenario);
    actions.setScenario(INTERSECTIONS[i].scenario);
  };
  const changeScenario = (s) => { setScenario(s); actions.setScenario(s); };

  return (
    <div className="app">
      <Header
        view={view}
        intersection={isect}
        onIntersection={changeIntersection}
        scenario={scenario}
        onScenario={changeScenario}
        speed={speed}
        onSpeed={actions.setSpeed}
        running={running}
        onToggleRun={() => actions.setRunning((r) => !r)}
        connection={connection}
        onDemand={(demand) => actions.restart({ demand })}
      />
      {connection && <EngineBanner connection={connection} onRestart={() => actions.restart()} />}
      <div className="shell">
        <div className="left">
          <KpiStrip view={view} />
          <IntersectionPanel
            sim={sim}
            view={view}
            theme={theme}
            onFrame={onFrame}
            intersection={INTERSECTIONS[isect]}
            selected={selected}
            onSelect={(p) => setSelected((cur) => (cur === p ? null : p))}
            onForce={() => selected !== null && actions.forcePhase(selected)}
            onResume={actions.resumeAuto}
          />
        </div>
        <SidePanel view={view} theme={theme} intersection={INTERSECTIONS[isect]} onEngineRestart={actions.restart} />
      </div>
    </div>
  );
}
