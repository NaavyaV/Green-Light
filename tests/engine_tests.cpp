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
int main(int argc,char** argv) {
    try {
        if(argc!=2)throw std::runtime_error("expected test name");
        std::string name=argv[1];
        if(name=="conservation")conservation();else if(name=="timing")timing();
        else if(name=="deterministic")deterministic();else if(name=="waiting")waiting();
        else if(name=="safety")safety();else throw std::runtime_error("unknown test");
        std::cout<<"PASS "<<name<<'\n';
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
