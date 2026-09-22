#include "frame_hub.hpp"
#include "shared_frames.hpp"
#include <future>
#include <iostream>
#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(#condition); } while (0)
int main() {
    using namespace poke;
    try {
        FrameHub hub(3); auto session=hub.reset(); cv::Mat source(12,16,CV_8UC3,cv::Scalar(1,2,3));
        auto first=hub.publish(source); source.setTo(cv::Scalar(9,9,9));
        CHECK(first->bgr.at<cv::Vec3b>(0,0)[0]==1);
        CHECK(hub.read().frame==hub.read().frame); // Independent readers, no destructive dequeue.
        for(int i=0;i<6;++i) hub.publish(source);
        auto slow=hub.read(1,true); CHECK(slow.frame->sequence==5 && slow.skipped==3);
        CHECK(hub.read(6,true).frame->sequence==7);
        CHECK(first->sequence==1 && first->bgr.at<cv::Vec3b>(0,0)[0]==1); // Eviction does not invalidate a retained snapshot.
        auto waiter=std::async(std::launch::async,[&] { return hub.read(7,true,2s,session); });
        hub.publish(source); CHECK(waiter.get().frame->sequence==8);
        SharedFrames shared(*first); shared.publish(*first);
        auto descriptor=shared.descriptor(); CHECK(descriptor["version"]==1);
        Handle mapping(OpenFileMappingW(FILE_MAP_READ,FALSE,wide(descriptor["mapping"]).c_str())); CHECK(mapping.get());
        auto bytes=MapViewOfFile(mapping.get(),FILE_MAP_READ,0,0,0); CHECK(bytes);
        CHECK(static_cast<const SharedHeader*>(bytes)->latest_sequence==1); UnmapViewOfFile(bytes);
        hub.reset(); bool changed=false;
        try { hub.read(0,false,0ms,session); } catch(const Error& error) { changed=error.code=="SESSION_CHANGED"; }
        CHECK(changed); hub.stop(); CHECK(!hub.read().frame);
        std::cout<<"Frame ownership, independent readers, overrun, session reset, shared memory: passed\n";
    } catch(const std::exception& error) { std::cerr<<error.what()<<"\n"; return 1; }
}
