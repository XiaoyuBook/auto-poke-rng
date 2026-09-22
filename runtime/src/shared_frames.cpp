#include "shared_frames.hpp"
#include <cstring>

namespace poke {
SharedFrames::SharedFrames(const Frame& frame) {
    capacity_=uint32_t(frame.bgr.total()*3); slots_=std::max<uint32_t>(2,std::min<uint32_t>(8,128*1024*1024/capacity_));
    mapping_name_="Local\\AutoPokeFrames-"+frame.session; mutex_name_=mapping_name_+"-mutex";
    mutex_.reset(CreateMutexW(nullptr,FALSE,wide(mutex_name_).c_str()));
    size_t size=64+size_t(slots_)*(32+capacity_);
    mapping_.reset(CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,DWORD(size),wide(mapping_name_).c_str()));
    if (!mapping_.get() || !mutex_.get()) throw Error("SHARED_MEMORY", "Cannot create frame mapping");
    bytes_=static_cast<unsigned char*>(MapViewOfFile(mapping_.get(),FILE_MAP_ALL_ACCESS,0,0,size));
    if (!bytes_) throw Error("SHARED_MEMORY", "Cannot map frames");
    SharedHeader header{}; std::memcpy(header.magic,"PKFRAME1",8);
    header.version=1; header.header_size=64; header.slot_count=slots_; header.payload_capacity=capacity_;
    header.width=frame.bgr.cols; header.height=frame.bgr.rows; header.stride=frame.bgr.cols*3; header.state=1;
    std::memcpy(bytes_,&header,64);
}
SharedFrames::~SharedFrames() {
    if (bytes_) {
        auto result=WaitForSingleObject(mutex_.get(),0);
        if (result==WAIT_OBJECT_0 || result==WAIT_ABANDONED) {
            reinterpret_cast<SharedHeader*>(bytes_)->state=0; ReleaseMutex(mutex_.get());
        }
        UnmapViewOfFile(bytes_);
    }
}
void SharedFrames::publish(const Frame& frame) {
    if (frame.bgr.total()*3!=capacity_) throw Error("FRAME_FORMAT", "Capture geometry changed; reconnect video source");
    auto result=WaitForSingleObject(mutex_.get(),0);
    if (result!=WAIT_OBJECT_0 && result!=WAIT_ABANDONED) return;
    auto data=bytes_+64+((frame.sequence-1)%slots_)*(32+capacity_);
    SlotHeader slot{frame.sequence,frame.timestamp_ns,capacity_,uint32_t(frame.bgr.cols),uint32_t(frame.bgr.rows),uint32_t(frame.bgr.cols*3)};
    std::memcpy(data+32,frame.bgr.data,capacity_); std::memcpy(data,&slot,32);
    auto header=reinterpret_cast<SharedHeader*>(bytes_);
    header->latest_sequence=frame.sequence; header->timestamp_ns=frame.timestamp_ns;
    ReleaseMutex(mutex_.get());
}
Json SharedFrames::descriptor() const { return {{"version",1},{"mapping",mapping_name_},{"mutex",mutex_name_},{"slots",slots_},{"capacity",capacity_},{"format","BGR24"},{"clock","qpc_ns"}}; }
}
