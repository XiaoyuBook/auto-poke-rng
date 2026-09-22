#pragma once
#include "frame_hub.hpp"

namespace poke {
// Fixed little-endian v1 ABI. All access, including headers, holds the named mutex.
// Producer tries the mutex without waiting: a slow external reader cannot block capture.
struct SharedHeader {
    char magic[8]; uint32_t version, header_size, slot_count, payload_capacity;
    uint64_t latest_sequence, timestamp_ns;
    uint32_t width, height, stride, state;
    uint64_t reserved;
};
struct SlotHeader {
    uint64_t sequence, timestamp_ns;
    uint32_t payload_size, width, height, stride;
};
static_assert(sizeof(SharedHeader)==64 && sizeof(SlotHeader)==32);
class SharedFrames {
    Handle mapping_, mutex_;
    unsigned char* bytes_=nullptr;
    std::string mapping_name_, mutex_name_;
    uint32_t capacity_=0, slots_=0;
public:
    SharedFrames(const Frame& first);
    ~SharedFrames();
    void publish(const Frame& frame);
    Json descriptor() const;
};
}
