#include "audio.hpp"
#include <future>
#include <iostream>
#include <limits>
#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(#condition); } while (0)
int main() {
    using namespace poke;
    try {
        const unsigned char s16[]={0,128,255,127,0,0};
        auto pcm=audio_pcm(s16,3,16,false,false); CHECK(pcm[0]==-1 && pcm[1]>.999f && pcm[2]==0);
        const unsigned char s24[]={0,0,128,255,255,127,255,255,255};
        pcm=audio_pcm(s24,3,24,false,false); CHECK(pcm[0]==-1 && pcm[1]>.999f && pcm[2]<0 && pcm[2]>-.00001f);
        const int32_t s32[]={INT32_MIN,INT32_MAX,0};
        pcm=audio_pcm(reinterpret_cast<const unsigned char*>(s32),3,32,false,false); CHECK(pcm[0]==-1 && pcm[1]>.999f && pcm[2]==0);
        const unsigned char s8[]={0,128,255}; pcm=audio_pcm(s8,3,8,false,false); CHECK(pcm[0]==-1 && pcm[1]==0 && pcm[2]>.99f);
        const float floats[]={.25f,-.5f,std::numeric_limits<float>::quiet_NaN(),2.f};
        pcm=audio_pcm(reinterpret_cast<const unsigned char*>(floats),4,32,true,false);
        CHECK(pcm[0]==.25f && pcm[1]==-.5f && pcm[2]==0 && pcm[3]==1);
        pcm=audio_pcm(nullptr,960,32,true,true); CHECK(pcm.size()==960 && pcm.back()==0);
        bool invalid=false; try { audio_pcm(nullptr,1,64,true,true); } catch(const Error&) { invalid=true; } CHECK(invalid);
        AudioHub hub(3); auto session=hub.reset();
        AudioBlock b; b.sample_rate=48000; b.channels=2; b.samples={.25f,-.25f}; b.timestamp_ns=now_ns();
        auto first=hub.publish(b); b.samples[0]=0;
        CHECK(first->samples[0]==.25f && first->session==session);
        CHECK(hub.read().block==hub.read().block);
        for(int i=0;i<6;++i) hub.publish(b);
        auto slow=hub.read(1,true); CHECK(slow.block->sequence==5 && slow.skipped==3);
        auto batch=hub.read_batch(1,2,0ms,session);
        CHECK(batch.size()==2 && batch[0].block->sequence==5 && batch[0].skipped==3);
        CHECK(batch[1].block->sequence==6 && batch[1].skipped==0);
        CHECK(hub.read_batch(6,64,0ms,session).back().block->sequence==7);
        CHECK(hub.read_batch(7,64,0ms,session).empty());
        invalid=false; try { hub.read_batch(1,65); } catch(const Error&) { invalid=true; } CHECK(invalid);
        auto waiter=std::async(std::launch::async,[&] { return hub.read(7,true,2s,session); });
        b.silent=true; b.discontinuity=true; b.timestamp_error=true;
        hub.publish(b); auto next=waiter.get();
        CHECK(next.block->sequence==8 && next.block->discontinuity && next.block->timestamp_error && next.block->silent);
        batch=hub.read_batch(7,64,0ms,session);
        CHECK(batch.size()==1 && batch[0].block->discontinuity && batch[0].block->timestamp_error && batch[0].block->silent);
        auto stopped=std::async(std::launch::async,[&] { return hub.read(8,true,2s,session); });
        hub.stop(); CHECK(!stopped.get().block && !hub.read().block && hub.read_batch(0).empty());
        hub.reset(); bool changed=false;
        try { hub.read(0,false,0ms,session); } catch(const Error& e) { changed=e.code=="SESSION_CHANGED"; }
        CHECK(changed); CHECK(first->samples[0]==.25f);
        changed=false; try { hub.read_batch(0,64,0ms,session); } catch(const Error& e) { changed=e.code=="SESSION_CHANGED"; }
        CHECK(changed);
        std::cout<<"PCM conversion, silence, ownership, independent cursors, overrun, wakeup and session changes: passed\n";
    } catch(const std::exception& error) { std::cerr<<error.what()<<"\n"; return 1; }
}
