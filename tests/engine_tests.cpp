#include "engine/TrafficEngine.hpp"
#include <iostream>
#include <stdexcept>
#include <string>
using namespace greenlight;
void expect(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
void conservation() {
    Simulator sim;
    std::array<std::uint64_t, movement_count> previous{};
    for (unsigned t = 0; t < 5000; ++t) {
        const auto& s = sim.step();
        auto green = green_movements(s.phase, s.stage);
        for (std::size_t i = 0; i < movement_count; ++i) {
            const auto& m = s.movements[i];
            expect(m.departures <= previous[i] + m.arrivals, "departures exceed available queue");
            expect(m.queue == previous[i] + m.arrivals - m.departures, "per-step conservation");
            expect(m.total_arrivals == m.queue + m.total_departures, "cumulative conservation");
            expect(green[i] || m.departures == 0, "departure without green");
            previous[i] = m.queue;
        }
        expect(!s.prediction, "ML prediction must remain unavailable");
    }
    for (const auto& m : sim.state().movements) expect(m.total_arrivals > 0 && m.total_departures > 0, "unserved movement");
}
void timing() {
    SignalPlan plan; FixedTimeController c(plan);
    for (unsigned cycle = 0; cycle < 3; ++cycle)
        for (unsigned phase = 0; phase < 4; ++phase)
            for (auto stage : {SignalStage::Green, SignalStage::Yellow, SignalStage::AllRed}) {
                unsigned duration = stage == SignalStage::Green ? plan.green_seconds[phase]
                                  : stage == SignalStage::Yellow ? plan.yellow_seconds : plan.all_red_seconds;
                for (unsigned second = 0; second < duration; ++second) {
                    expect(static_cast<unsigned>(c.phase()) == phase && c.stage() == stage, "phase timing mismatch");
                    expect(c.elapsed() == second, "elapsed time mismatch");
                    c.advance();
                }
            }
    Simulator sim;
    for (unsigned t = 1; t <= 15; ++t) {
        const auto& s = sim.step();
        expect(s.stage == (t <= 10 ? SignalStage::Green : t <= 13 ? SignalStage::Yellow : SignalStage::AllRed), "published interval mismatch");
    }
    expect(sim.step().phase == SignalPhase::NS_THROUGH_RIGHT, "next phase must begin at interval 16");
}
void deterministic() {
    SimulationConfig a,b; b.seed = 123;
    Simulator first(a), replay(a), different(b);
    bool differs = false;
    for (unsigned t = 0; t < 1000; ++t) {
        auto x = status_line(first.step()), y = status_line(replay.step());
        expect(x == y, "seeded replay differs");
        differs = status_line(different.step()) != x || differs;
        const auto& s = first.state(); const auto& r = replay.state();
        for (std::size_t i=0;i<movement_count;++i) {
            const auto& m=s.movements[i];const auto& n=r.movements[i];
            expect(m.total_arrivals==n.total_arrivals && m.total_departures==n.total_departures &&
                   m.queued_vehicle_seconds==n.queued_vehicle_seconds && m.departed_wait_seconds==n.departed_wait_seconds,
                   "replay cumulative statistics differ");
        }
    }
    expect(differs, "different seed produced identical run");
}
void waiting() {
    SimulationConfig c; c.arrival_probability.fill(1);
    Simulator sim(c);
    for (unsigned t = 1; t <= 10; ++t) {
        const auto& s = sim.step();
        expect(s.movements[0].queue == 0 && s.movements[0].departed_wait_seconds == 0, "immediate service should not wait");
        expect(s.movements[1].queue == t, "red queue size");
        expect(s.movements[1].queued_vehicle_seconds == static_cast<std::uint64_t>(t)*(t+1)/2, "red vehicle seconds");
    }
    // Independent FIFO accounting for every vehicle, including vehicles still queued.
    std::array<std::deque<std::uint64_t>,movement_count> pending;
    std::array<std::uint64_t,movement_count> accumulated{}, departed{};
    Simulator reference(c);
    for (unsigned t=0;t<400;++t) {
        const auto& s=reference.step();
        for (std::size_t i=0;i<movement_count;++i) {
            auto& q=pending[i]; q.push_back(t);
            for (std::uint64_t j=0;j<s.movements[i].departures;++j) {
                departed[i]+=t-q.front();q.pop_front();
            }
            accumulated[i]+=q.size();
            std::uint64_t pending_wait=0;
            for(auto arrival:q) pending_wait+=t+1-arrival;
            expect(accumulated[i]==departed[i]+pending_wait, "waiting-time identity");
            expect(s.movements[i].departed_wait_seconds==departed[i] && s.movements[i].queued_vehicle_seconds==accumulated[i], "waiting totals");
        }
    }
    c.arrival_probability.fill(0); Simulator empty(c);
    for(int t=0;t<100;++t) empty.step();
    expect(empty.state().throughput()==0 && empty.state().total_queue()==0 && empty.state().mean_departed_wait()==0, "zero demand");
}
void safety() {
    for(unsigned p=0;p<4;++p) {
        auto mask=green_movements(static_cast<SignalPhase>(p),SignalStage::Green);
        for(std::size_t i=0;i<movement_count;++i) for(std::size_t j=i+1;j<movement_count;++j)
            expect(!(mask[i] && mask[j]) || !conflicting(static_cast<Movement>(i),static_cast<Movement>(j)), "conflicting greens");
        for(auto stage:{SignalStage::Yellow,SignalStage::AllRed})
            for(bool green:green_movements(static_cast<SignalPhase>(p),stage)) expect(!green,"clearance green");
    }
    expect(conflicting(Movement::N_THROUGH,Movement::E_THROUGH),"crossing through conflict");
    expect(conflicting(Movement::N_LEFT,Movement::S_THROUGH),"opposing left conflict");
    for(int invalid=0;invalid<6;++invalid) {
        SimulationConfig c;
        if(invalid==0)c.signals.green_seconds[0]=4;
        if(invalid==1)c.signals.green_seconds[0]=41;
        if(invalid==2)c.signals.yellow_seconds=0;
        if(invalid==3)c.signals.all_red_seconds=0;
        if(invalid==4)c.arrival_probability[0]=1.1;
        if(invalid==5)c.service_per_green_second=0;
        bool rejected=false;try { Simulator s(c); } catch(const std::invalid_argument&) {rejected=true;}
        expect(rejected,"invalid config accepted");
    }
}
void reactive_limits() {
    SignalPlan plan; plan.min_green = 3; plan.max_green = 7;
    plan.green_seconds.fill(5); plan.yellow_seconds = 2; plan.all_red_seconds = 1;
    std::array<MovementState, movement_count> demand{};
    demand[7].queue = 50; // EW through must win over the initial NS left.
    ReactiveController c(plan);
    for (unsigned i = 0; i < plan.min_green; ++i) {
        expect(c.stage() == SignalStage::Green, "reactive ended green before minimum");
        c.advance(demand);
    }
    expect(c.stage() == SignalStage::Yellow, "reactive did not select higher queue");
    demand[7].queue = 0; demand[1].queue = 100; // Must not change locked next phase.
    for (unsigned i = 0; i < 2; ++i) {
        expect(c.stage() == SignalStage::Yellow, "reactive yellow duration"); c.advance(demand);
    }
    expect(c.stage() == SignalStage::AllRed, "reactive skipped all-red"); c.advance(demand);
    expect(c.phase() == SignalPhase::EW_THROUGH_RIGHT && c.stage() == SignalStage::Green,
           "reactive clearance did not preserve selected phase");
    demand.fill({}); demand[7].queue = 100;
    for (unsigned i = 0; i < plan.max_green; ++i) {
        expect(c.stage() == SignalStage::Green, "reactive failed to extend busy green"); c.advance(demand);
    }
    expect(c.stage() == SignalStage::Yellow, "reactive exceeded maximum green");
    // Zero demand ties must remain deterministic and still respect max green.
    ReactiveController idle(plan); demand.fill({});
    for (unsigned i=0;i<plan.max_green;++i) {
        expect(idle.stage()==SignalStage::Green,"idle green ended early"); idle.advance(demand);
    }
    expect(idle.stage()==SignalStage::Yellow,"idle green exceeded maximum");
}
void reactive_simulation() {
    SimulationConfig config; config.controller = ControllerMode::Reactive;
    Simulator sim(config), replay(config);
    SimulationConfig baseline = config; baseline.controller = ControllerMode::Fixed;
    Simulator fixed(baseline);
    SignalStage previous_stage = SignalStage::Green;
    SignalPhase previous_phase = SignalPhase::NS_LEFT;
    unsigned run = 0;
    std::array<std::uint64_t, movement_count> previous_queue{};
    for (unsigned t=0;t<5000;++t) {
        const auto& s=sim.step(); const auto& r=replay.step(); const auto& f=fixed.step();
        expect(status_line(s)==status_line(r),"reactive deterministic replay");
        if (s.stage != previous_stage) {
            if(previous_stage==SignalStage::Green) {
                expect(run>=config.signals.min_green && run<=config.signals.max_green,"reactive green limits");
                expect(s.stage==SignalStage::Yellow,"green must transition to yellow");
            } else if(previous_stage==SignalStage::Yellow) {
                expect(run==config.signals.yellow_seconds && s.stage==SignalStage::AllRed,"yellow clearance");
            } else {
                expect(run==config.signals.all_red_seconds && s.stage==SignalStage::Green,"all-red clearance");
                expect(s.phase!=previous_phase,"reactive failed to switch phase");
            }
            run=0;
        } else expect(s.phase==previous_phase,"phase changed without clearance");
        ++run;
        if(s.stage==SignalStage::Green) expect(run<=config.signals.max_green,"unbounded green");
        previous_stage=s.stage;previous_phase=s.phase;
        const auto mask=green_movements(s.phase,s.stage);
        for(std::size_t i=0;i<movement_count;++i) {
            const auto& m=s.movements[i]; const auto& n=r.movements[i];
            expect(m.arrivals==f.movements[i].arrivals,"controllers received different arrival streams");
            expect(m.total_arrivals==m.total_departures+m.queue,"reactive cumulative conservation");
            expect(m.departures<=previous_queue[i]+m.arrivals,"reactive over-service");
            expect(m.queue==previous_queue[i]+m.arrivals-m.departures,"reactive step conservation");
            expect(mask[i] || m.departures==0,"reactive departure without green");
            expect(m.queued_vehicle_seconds==n.queued_vehicle_seconds && m.departed_wait_seconds==n.departed_wait_seconds,
                   "reactive replay waiting statistics");
            previous_queue[i]=m.queue;
            for(std::size_t j=i+1;j<movement_count;++j)
                expect(!(mask[i] && mask[j]) || !conflicting(static_cast<Movement>(i),static_cast<Movement>(j)),
                       "reactive conflicting greens");
        }
        expect(!s.prediction,"reactive must not use ML");
    }
    // Different seed must change reactive arrivals.
    config.seed=123;Simulator other(config);Simulator original;
    bool different=false;
    for(unsigned t=0;t<100;++t) {
        const auto& a=other.step();const auto& b=original.step();
        for(std::size_t i=0;i<movement_count;++i)different=different || a.movements[i].arrivals!=b.movements[i].arrivals;
    }
    expect(different,"reactive seed ignored");
}
void reactive_fairness() {
    SignalPlan plan; plan.min_green=3;plan.max_green=7;plan.green_seconds.fill(5);
    plan.yellow_seconds=2;plan.all_red_seconds=1;
    const unsigned bound=2*(plan.max_green+plan.yellow_seconds+plan.all_red_seconds)
                         +4*(plan.max_green+plan.yellow_seconds+plan.all_red_seconds);
    // Persistent one-vehicle demand must receive service even against huge queues.
    std::array<MovementState,movement_count> queues{};
    queues[0].queue=1;queues[1].queue=100000;queues[6].queue=1;queues[7].queue=100000;
    ReactiveController c(plan),replay(plan);
    std::array<unsigned,4> unserved{},visits{};
    for(unsigned t=0;t<2000;++t) {
        expect(c.phase()==replay.phase() && c.stage()==replay.stage() && c.elapsed()==replay.elapsed(),"fairness replay");
        for(unsigned p=0;p<4;++p) {
            if(c.stage()==SignalStage::Green && static_cast<unsigned>(c.phase())==p){unserved[p]=0;++visits[p];}
            else ++unserved[p];
            expect(unserved[p]<=bound,"persistent demand exceeded bounded service gap");
        }
        c.advance(queues);replay.advance(queues);
    }
    for(auto n:visits)expect(n>0,"phase starved");
    // A small pressure change cannot interrupt a nonempty green before its batch.
    queues.fill({});queues[0].queue=10;queues[1].queue=11;
    ReactiveController batch(plan);
    for(unsigned t=0;t<plan.green_seconds[0];++t){
        expect(batch.stage()==SignalStage::Green,"unnecessary short-green switch");batch.advance(queues);
    }
    // Equal queues: genuine head wait should break demand ties after the batch.
    queues.fill({});queues[0].queue=10;queues[7].queue=10;queues[7].oldest_wait_seconds=50;
    ReactiveController aged(plan);
    for(unsigned t=0;t<plan.green_seconds[0];++t)aged.advance(queues);
    expect(aged.stage()==SignalStage::Yellow,"waiting-time pressure ignored");
    for(unsigned t=0;t<plan.yellow_seconds+plan.all_red_seconds;++t)aged.advance(queues);
    expect(aged.phase()==SignalPhase::EW_THROUGH_RIGHT,"oldest wait did not affect selection");
}
void reactive_multiseed() {
    for(unsigned seed:{42,7,123}) {
        SimulationConfig c;c.seed=seed;c.controller=ControllerMode::Reactive;
        Simulator reactive(c), replay(c);c.controller=ControllerMode::Fixed;Simulator fixed(c);
        for(unsigned t=0;t<3000;++t) {
            const auto& r=reactive.step();const auto& f=fixed.step();const auto& copy=replay.step();
            expect(status_line(r)==status_line(copy),"multi-seed replay");
            for(std::size_t i=0;i<movement_count;++i) {
                const auto& m=r.movements[i];
                expect(m.arrivals==f.movements[i].arrivals,"multi-seed stream differs");
                expect(m.total_arrivals==m.total_departures+m.queue,"multi-seed conservation");
                expect(m.oldest_wait_seconds==copy.movements[i].oldest_wait_seconds,"oldest-wait replay");
                expect(m.queue || m.oldest_wait_seconds==0,"empty queue has head wait");
            }
        }
    }
}
int main(int argc,char** argv) {
    try {
        if(argc!=2)throw std::runtime_error("expected test name");
        std::string name=argv[1];
        if(name=="conservation")conservation();else if(name=="timing")timing();
        else if(name=="deterministic")deterministic();else if(name=="waiting")waiting();
        else if(name=="safety")safety();
        else if(name=="reactive_limits")reactive_limits();
        else if(name=="reactive_simulation")reactive_simulation();
        else if(name=="reactive_fairness")reactive_fairness();
        else if(name=="reactive_multiseed")reactive_multiseed();else throw std::runtime_error("unknown test");
        std::cout<<"PASS "<<name<<'\n';
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
