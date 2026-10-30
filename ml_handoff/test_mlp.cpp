// Checks that the C++ forward pass reproduces Python's predictions.
//   g++ -std=c++17 -O2 test_mlp.cpp -o test_mlp
//   ./test_mlp model_weights.txt test_vectors.csv
#include <cmath>
#include <iostream>
#include <sstream>

#include "traffic_mlp.hpp"

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "usage: " << argv[0] << " model_weights.txt test_vectors.csv\n";
        return 2;
    }
    TrafficMLP m;
    m.load(argv[1]);
    const size_t nin = m.sizes.front(), nout = m.sizes.back();

    std::ifstream f(argv[2]);
    if (!f) {
        std::cerr << "cannot open " << argv[2] << "\n";
        return 2;
    }
    std::string line;
    std::getline(f, line);  // skip header
    int rows = 0;
    double worst = 0.0;
    while (std::getline(f, line)) {
        std::stringstream ss(line);
        std::string cell;
        std::vector<double> v;
        while (std::getline(ss, cell, ',')) v.push_back(std::stod(cell));
        if (v.size() != nin + nout) {
            std::cerr << "row " << rows << ": expected " << nin + nout << " columns, got " << v.size() << "\n";
            return 2;
        }
        std::vector<double> x(v.begin(), v.begin() + nin);
        auto y = m.forward_raw(x);
        for (size_t k = 0; k < nout; ++k) worst = std::max(worst, std::fabs(y[k] - v[nin + k]));
        ++rows;
    }
    std::cout << rows << " test vectors, max abs difference = " << worst << "\n";
    const bool ok = rows > 0 && worst < 1e-3;
    std::cout << (ok ? "PASS" : "FAIL") << "\n";
    return ok ? 0 : 1;
}
