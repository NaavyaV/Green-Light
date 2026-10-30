// From the repository root (C++17, no external dependencies):
// g++ -std=c++17 -O2 ml_handoff/demo_inference.cpp -o /tmp/green-light-demo
// /tmp/green-light-demo ml_handoff/model_weights.txt ml_handoff/test_vectors.csv
// Reads the first reference row; forecasts arrivals, without controlling signals.
#include "traffic_mlp.hpp"
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>

namespace {
const std::array<std::string, 12> movements = {
    "N_LEFT", "N_THROUGH", "N_RIGHT", "S_LEFT", "S_THROUGH", "S_RIGHT",
    "E_LEFT", "E_THROUGH", "E_RIGHT", "W_LEFT", "W_THROUGH", "W_RIGHT"
};

std::vector<std::string> split(std::string line) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    std::vector<std::string> cells;
    std::stringstream stream(line);
    std::string cell;
    while (std::getline(stream, cell, ',')) cells.push_back(cell);
    if (!line.empty() && line.back() == ',') cells.emplace_back();
    return cells;
}

void require(bool ok, const std::string& message) {
    if (!ok) throw std::runtime_error(message);
}

void finite_values(const std::vector<double>& values) {
    for (double v : values) require(std::isfinite(v), "model contains nonfinite values");
}
} // namespace

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "usage: " << argv[0] << " model_weights.txt test_vectors.csv\n";
        return 2;
    }
    try {
        // Guard the reference loader against invalid architecture dimensions before loading.
        std::ifstream model_file(argv[1]);
        require(bool(model_file), "cannot open model file: " + std::string(argv[1]));
        for (int expected : {5, 60, 128, 64, 32, 12}) {
            int actual = 0;
            require(bool(model_file >> actual) && actual == expected,
                    "malformed model header: expected 5 60 128 64 32 12");
        }
        TrafficMLP model;
        model.load(argv[1]);
        finite_values(model.mean);
        finite_values(model.scale);
        finite_values(model.target_min);
        finite_values(model.target_scale);
        for (double v : model.scale) require(v > 0, "invalid input scaler: scale must be positive");
        for (double v : model.target_scale) require(v > 0, "invalid output scaler: scale must be positive");
        for (const auto& w : model.W) finite_values(w);
        for (const auto& b : model.b) finite_values(b);

        std::ifstream input(argv[2]);
        require(bool(input), "cannot open test vectors: " + std::string(argv[2]));
        std::string line;
        require(bool(std::getline(input, line)), "missing CSV header");
        std::vector<std::string> expected_header;
        for (const auto& m : movements)
            for (const auto& feature : {"arr5", "arr15", "arr30", "arr60", "avg_speed"})
                expected_header.push_back(m + "_" + feature);
        for (const auto& m : movements) expected_header.push_back("pred_target_" + m);
        require(split(line) == expected_header, "CSV header does not match ML_INTERFACE.md ordering");
        require(bool(std::getline(input, line)), "missing first reference input row");
        auto cells = split(line);
        require(cells.size() == 72, "first reference row must contain 60 inputs and 12 predictions (72 columns)");
        std::vector<double> values;
        for (size_t i = 0; i < cells.size(); ++i) {
            std::istringstream number(cells[i]);
            double v = 0;
            require(bool(number >> v) && std::isfinite(v),
                    "invalid finite number at CSV column " + std::to_string(i + 1));
            number >> std::ws;
            require(number.eof(), "trailing text at CSV column " + std::to_string(i + 1));
            values.push_back(v);
        }
        std::vector<double> x(values.begin(), values.begin() + 60);
        auto raw = model.forward_raw(x);
        auto counts = model.predict(x);
        require(raw.size() == 12 && counts.size() == 12, "inference returned an invalid output size");
        double worst_raw = 0, worst_clamped = 0;
        for (size_t i = 0; i < movements.size(); ++i) {
            require(std::isfinite(raw[i]) && std::isfinite(counts[i]), "inference returned nonfinite predictions");
            worst_raw = std::max(worst_raw, std::abs(raw[i] - values[60 + i]));
            worst_clamped = std::max(worst_clamped, std::abs(counts[i] - std::max(0.0, values[60 + i])));
        }
        require(worst_raw < 1e-3 && worst_clamped < 1e-3, "inference disagrees with reference predictions (tolerance 0.001)");
        std::cout << "Reference input: first data row (60 features)\n"
                  << "Forecast horizon: next 30 seconds\n"
                  << "Predicted vehicle arrivals (nonnegative counts, not rounded to integers):\n"
                  << std::fixed << std::setprecision(6);
        for (size_t i = 0; i < movements.size(); ++i)
            std::cout << movements[i] << ": " << counts[i] << '\n';
        std::cout << std::scientific << "Reference parity: PASS (max raw difference " << worst_raw
                  << ", max clamped difference " << worst_clamped << ")\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Inference demo failed: " << error.what() << '\n';
        return 1;
    }
}
