// Reference C++ inference for the Green Light traffic MLP (header only, no dependencies).
//
//   TrafficMLP mlp;
//   mlp.load("model_weights.txt");
//   std::vector<double> x = {...60 values, order in ML_INTERFACE.md...};
//   std::vector<double> arrivals = mlp.predict(x);   // 12 values, next-30-second arrivals, clamped >= 0
#pragma once
#include <algorithm>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

struct TrafficMLP {
    std::vector<int> sizes;                    // e.g. 60 128 64 32 12
    std::vector<double> mean, scale;           // input scaling
    std::vector<std::vector<double>> W, b;     // W[l] is row-major [out][in]

    void load(const std::string& path) {
        std::ifstream f(path);
        if (!f) throw std::runtime_error("cannot open " + path);
        int n = 0;
        f >> n;
        sizes.resize(n);
        for (auto& s : sizes) f >> s;
        mean.resize(sizes[0]);
        scale.resize(sizes[0]);
        for (auto& v : mean) f >> v;
        for (auto& v : scale) f >> v;
        W.clear();
        b.clear();
        for (int l = 0; l + 1 < n; ++l) {
            W.emplace_back(static_cast<size_t>(sizes[l + 1]) * sizes[l]);
            b.emplace_back(sizes[l + 1]);
            for (auto& v : W.back()) f >> v;
            for (auto& v : b.back()) f >> v;
        }
        if (!f) throw std::runtime_error("bad or truncated weights file: " + path);
    }

    // Raw network output (not clamped). Used to compare against Python.
    std::vector<double> forward_raw(const std::vector<double>& x) const {
        if (x.size() != static_cast<size_t>(sizes.front()))
            throw std::runtime_error("expected " + std::to_string(sizes.front()) + " inputs");
        std::vector<double> h(x.size());
        for (size_t i = 0; i < x.size(); ++i) h[i] = (x[i] - mean[i]) / scale[i];
        const size_t layers = W.size();
        for (size_t l = 0; l < layers; ++l) {
            const size_t in = sizes[l], out = sizes[l + 1];
            std::vector<double> y(out);
            for (size_t o = 0; o < out; ++o) {
                double s = b[l][o];
                for (size_t i = 0; i < in; ++i) s += W[l][o * in + i] * h[i];
                y[o] = (l + 1 < layers) ? std::max(0.0, s) : s;   // ReLU on hidden layers only
            }
            h = std::move(y);
        }
        return h;
    }

    // What the controller should use: predicted arrivals per movement, never negative.
    std::vector<double> predict(const std::vector<double>& x) const {
        auto y = forward_raw(x);
        for (auto& v : y) v = std::max(0.0, v);
        return y;
    }
};
