import { useState } from 'react';
import { INTERSECTIONS } from './sim/constants.js';
import { useSimulation } from './hooks/useSimulation.js';
import { useTheme } from './hooks/useTheme.js';
import Header from './components/Header.jsx';
import KpiStrip from './components/KpiStrip.jsx';
import IntersectionPanel from './components/IntersectionPanel.jsx';
import SidePanel from './components/SidePanel.jsx';

export default function App() {
  const [isect, setIsect] = useState(0);
  const [scenario, setScenario] = useState(INTERSECTIONS[0].scenario);
  const [selected, setSelected] = useState(null);
  const { sim, view, running, speed, actions, onFrame } = useSimulation(scenario);
  const theme = useTheme();

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
      />
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
        <SidePanel view={view} theme={theme} intersection={INTERSECTIONS[isect]} />
      </div>
    </div>
  );
}
