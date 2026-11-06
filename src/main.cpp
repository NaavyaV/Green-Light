//entry point: builds the sim, runes the 1s loop
#include "engine/TrafficEngine.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

unsigned parse_unsigned(const char* text) {
    const std::string s(text);
    if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos)
        throw std::invalid_argument("arguments must be unsigned integers");
    auto n = std::stoull(s);
    if (n > std::numeric_limits<unsigned>::max()) throw std::out_of_range("argument too large");
    return static_cast<unsigned>(n);
}
int main(int argc, char** argv) {
    try {
        int arg = 1;
        unsigned seconds = 60;
        bool jsonl = false;
        greenlight::SimulationConfig config;
        if (arg < argc && std::string(argv[arg]).rfind("--", 0) != 0)
            seconds = parse_unsigned(argv[arg++]);
        if (arg < argc && std::string(argv[arg]).rfind("--", 0) != 0)
            config.seed = parse_unsigned(argv[arg++]);
        while (arg < argc) {
            const std::string option(argv[arg++]);
            if (arg == argc) throw std::invalid_argument("Missing value for " + option);
            const std::string value(argv[arg++]);
            if (option == "--controller") {
                if (value == "reactive") config.controller = greenlight::ControllerMode::Reactive;
                else if (value == "predictive") config.controller = greenlight::ControllerMode::Predictive;
                else if (value == "fixed") config.controller = greenlight::ControllerMode::Fixed;
                else throw std::invalid_argument("controller must be fixed, reactive, or predictive");
            } else if (option == "--demand") {
                config.set_demand_preset(value);
            } else if (option == "--format") {
                if (value != "text" && value != "jsonl")
                    throw std::invalid_argument("format must be text or jsonl");
                jsonl = value == "jsonl";
            } else if (option == "--ml-impute-speed") {
                config.imputed_speed_model = value;
            } else {
                throw std::invalid_argument("Unknown option: " + option);
            }
        }
        greenlight::Simulator sim(config);
        for (unsigned t = 0; t < seconds; ++t) {
            const auto& state = sim.step();
            if (jsonl) {
                std::cout << greenlight::snapshot_json(state, config.controller) << '\n';
                continue;
            }
            std::cout << greenlight::status_line(state) << '\n';
            if (state.prediction && state.prediction->generated_at == state.time_seconds) {
                std::cout << "forecast t=" << state.time_seconds
                          << " horizon=30s speed=imputed_training_mean";
                for (std::size_t i = 0; i < greenlight::movement_count; ++i)
                    std::cout << ' ' << greenlight::movement_names[i] << '='
                              << state.prediction->arrivals[i];
                std::cout << '\n';
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Engine error: " << e.what() << '\n'; return 1;
    }
}
