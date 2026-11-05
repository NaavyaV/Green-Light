cmake_minimum_required(VERSION 3.16)
project(GreenLight LANGUAGES CXX)

# C++17, no compiler-specific extensions.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Shared compile settings for every target in the project:
# src/ is the include root (#include "core/Types.hpp"), and warnings are on.
add_library(green_light_options INTERFACE)
target_include_directories(green_light_options INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/src)
if(MSVC)
    target_compile_options(green_light_options INTERFACE /W4)
else()
    target_compile_options(green_light_options INTERFACE -Wall -Wextra -Wpedantic)
endif()

# Engine code shared by the program and the tests. Each stage adds its .cpp files here.
add_library(green_light_engine STATIC
    src/sim/Intersection.cpp
    src/sim/ArrivalGenerator.cpp
)
target_link_libraries(green_light_engine PUBLIC green_light_options)

# Main program.
add_executable(green_light src/main.cpp)
target_link_libraries(green_light PRIVATE green_light_engine)

# Tests: one executable per test file, each registered with CTest.
enable_testing()

add_executable(test_intersection tests/test_intersection.cpp)
target_link_libraries(test_intersection PRIVATE green_light_engine)
add_test(NAME test_intersection COMMAND test_intersection)

add_executable(test_arrival_generator tests/test_arrival_generator.cpp)
target_link_libraries(test_arrival_generator PRIVATE green_light_engine)
add_test(NAME test_arrival_generator COMMAND test_arrival_generator)
