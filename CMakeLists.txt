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

# Main program.
add_executable(green_light src/main.cpp)
target_link_libraries(green_light PRIVATE green_light_options)

# Tests are added in later stages with add_executable + add_test.
enable_testing()
