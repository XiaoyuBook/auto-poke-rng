#pragma once
#include <windows.h>
#include <json.hpp>
#include <chrono>
#include <functional>
#include <mutex>
#include <string>
#include <stdexcept>

namespace poke {
using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
using Emit = std::function<void(const Json&)>;
struct Error : std::runtime_error {
    std::string code;
    Error(std::string code, std::string message) : std::runtime_error(message), code(std::move(code)) {}
};
inline uint64_t now_ns() {
    LARGE_INTEGER value, frequency;
    QueryPerformanceCounter(&value); QueryPerformanceFrequency(&frequency);
    return uint64_t(value.QuadPart / frequency.QuadPart) * 1'000'000'000ULL
        + uint64_t(value.QuadPart % frequency.QuadPart) * 1'000'000'000ULL / frequency.QuadPart;
}
std::string uuid();
std::string utf8(const std::wstring& value);
std::wstring wide(const std::string& value);
Json video_devices(const std::string& backend);
Json serial_devices();
class Handle {
    HANDLE value_ = nullptr;
public:
    explicit Handle(HANDLE value = nullptr) : value_(value) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE get() const { return value_; }
    void reset(HANDLE value = nullptr) {
        if (value_ && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
        value_ = value;
    }
};
inline int integer(const Json& j, const char* key, int fallback, int min, int max) {
    if (j.contains(key) && !j.at(key).is_number_integer()) throw Error("INVALID_ARGUMENT", std::string(key) + " must be an integer");
    auto value = j.value(key, int64_t(fallback));
    if (value < min || value > max) throw Error("INVALID_ARGUMENT", std::string(key) + " out of range");
    return int(value);
}
}
