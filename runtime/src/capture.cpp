#include "capture.hpp"
#include <opencv2/videoio.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/imgcodecs.hpp>

namespace poke {
CaptureService::CaptureService(Emit emit, bool test_mode) : emit_(std::move(emit)), test_mode_(test_mode), token_(uuid()+uuid()) {
    // Matches the existing Capture Broker workaround for drivers that stall in MSMF GPU transforms.
    if (!std::getenv("OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS")) _putenv_s("OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS","0");
    server_.new_task_queue=[] { return new httplib::ThreadPool(12,32); };
    server_.set_read_timeout(2,0); server_.set_write_timeout(2,0); server_.set_payload_max_length(4096);
    routes(); port_=server_.bind_to_any_port("127.0.0.1");
    if (port_<=0) throw Error("PREVIEW_START", "Cannot start local preview server");
    http_=std::thread([this] { server_.listen_after_bind(); });
}
CaptureService::~CaptureService() { stop(); server_.stop(); if (http_.joinable()) http_.join(); }
Json CaptureService::status() const { std::lock_guard lock(state_mutex_); return state_; }
void CaptureService::state(Json value) {
    { std::lock_guard lock(state_mutex_); state_=value; }
    emit_({{"event","video.state"},{"state",std::move(value)}});
}
void CaptureService::stop() {
    stop_=true; hub_.stop(); jpeg_changed_.notify_all();
    if (capture_.joinable()) capture_.join(); // Isolated process: Electron bounds hung driver shutdown.
    if (encoder_.joinable()) encoder_.join();
    { std::lock_guard lock(jpeg_mutex_); preview_.reset(); }
    state({{"status","idle"}});
}
Json CaptureService::command(const std::string& method,const Json& args) {
    if (method=="video.list") {
        auto backend=args.value("backend",std::string("msmf"));
        auto list=video_devices(backend);
        if (test_mode_) list.push_back({{"id","synthetic"},{"name","测试彩条（模拟）"},{"index",-1},{"backend",backend}});
        return list;
    }
    if (method=="video.status") return status();
    if (method=="video.stop") { stop(); return status(); }
    if (method=="video.start") {
        if (status().value("status","")=="connected" || !stop_) throw Error("BUSY","请先断开当前视频源");
        integer(args,"width",1920,160,3840); integer(args,"height",1080,120,2160); integer(args,"fps",30,1,60);
        auto backend=args.value("backend",std::string("msmf"));
        if (backend!="msmf" && backend!="dshow") throw Error("INVALID_ARGUMENT","不支持的采集后端");
        if (!args.contains("deviceId") || !args["deviceId"].is_string()) throw Error("INVALID_ARGUMENT","请选择视频设备");
        if (args["deviceId"]=="synthetic" && !test_mode_) throw Error("INVALID_ARGUMENT","模拟设备仅供测试");
        stop(); hub_.reset(); stop_=false;
        state({{"status","connecting"},{"deviceId",args["deviceId"]},{"backend",backend}});
        capture_=std::thread([this,args] { capture_loop(args); });
        encoder_=std::thread([this] { encode_loop(); });
        return {{"accepted",true}};
    }
    throw Error("METHOD_NOT_FOUND","Unknown video method");
}
void CaptureService::capture_loop(Json config) {
    Handle ownership(CreateMutexW(nullptr,FALSE,L"Local\\AutoPokeRng-CaptureOwner-v1"));
    bool owned=false;
    try {
        auto result=WaitForSingleObject(ownership.get(),0);
        if (result!=WAIT_OBJECT_0 && result!=WAIT_ABANDONED) throw Error("DEVICE_BUSY","另一个 Auto Poke RNG 实例正在使用视频源");
        owned=true;
        int width=config.value("width",1920),height=config.value("height",1080),fps=config.value("fps",30);
        bool synthetic=config["deviceId"]=="synthetic";
        std::string backend=config.value("backend",std::string("msmf")), name="测试彩条（模拟）";
        cv::VideoCapture capture;
        if (!synthetic) {
            auto devices=video_devices(backend); int index=-1;
            for (const auto& item:devices) if (item["id"]==config["deviceId"]) { index=item["index"]; name=item["name"]; break; }
            if (index<0) throw Error("DEVICE_MISSING","视频设备已移除，请刷新设备列表");
            if (!capture.open(index,backend=="msmf" ? cv::CAP_MSMF : cv::CAP_DSHOW)) throw Error("CAPTURE_OPEN","无法打开视频源，可能被其他程序占用");
            // DSHOW rebuilds the graph when FPS changes: apply its native MJPG subtype last.
            capture.set(cv::CAP_PROP_FPS,fps); capture.set(cv::CAP_PROP_FRAME_WIDTH,width); capture.set(cv::CAP_PROP_FRAME_HEIGHT,height);
            if (backend=="dshow") capture.set(cv::CAP_PROP_FOURCC,cv::VideoWriter::fourcc('M','J','P','G'));
        }
        std::unique_ptr<SharedFrames> shared;
        auto first_deadline=Clock::now()+5s, last_frame=Clock::now();
        uint64_t synthetic_frame=0; int actual_width=0,actual_height=0;
        while (!stop_) {
            auto tick=Clock::now(); cv::Mat bgr;
            if (synthetic) {
                bgr=cv::Mat(height,width,CV_8UC3,cv::Scalar(35,45,50));
                for (int i=0;i<8;++i) cv::rectangle(bgr,{i*width/8,0,width/8,height/2},cv::Scalar((i*37)%255,(i*83)%255,(i*113)%255),cv::FILLED);
                cv::putText(bgr,"AUTO POKE RNG  /  "+std::to_string(++synthetic_frame),{25,height*3/4},cv::FONT_HERSHEY_SIMPLEX,1,cv::Scalar(220,230,230),2);
            } else if (!capture.read(bgr) || bgr.empty()) {
                if ((!shared && Clock::now()>first_deadline) || (shared && Clock::now()-last_frame>1s)) throw Error("NO_FRAMES","视频源没有新画面，请检查采集卡连接");
                std::this_thread::sleep_for(10ms); continue;
            }
            if (stop_) break;
            if (bgr.cols>3840 || bgr.rows>2160 || bgr.type()!=CV_8UC3) throw Error("FRAME_FORMAT","视频源未输出支持的 BGR24 画面");
            if (shared && (bgr.cols!=actual_width || bgr.rows!=actual_height)) throw Error("FRAME_FORMAT","视频尺寸发生变化，请重新连接");
            last_frame=Clock::now();
            auto frame=hub_.publish(bgr); if (!frame) break;
            if (!shared) {
                shared=std::make_unique<SharedFrames>(*frame); actual_width=bgr.cols;actual_height=bgr.rows;
                shared->publish(*frame);
                state({{"status","connected"},{"deviceId",config["deviceId"]},{"name",name},{"backend",backend},
                    {"width",bgr.cols},{"height",bgr.rows},{"requestedFps",fps},{"reportedFps",synthetic ? double(fps) : capture.get(cv::CAP_PROP_FPS)},
                    {"session",frame->session},{"sharedMemory",shared->descriptor()},
                    {"baseUrl","http://127.0.0.1:"+std::to_string(port_)},{"token",token_},
                    {"previewUrl","http://127.0.0.1:"+std::to_string(port_)+"/preview?token="+httplib::detail::encode_url(token_)+"&session="+httplib::detail::encode_url(frame->session)}});
            } else shared->publish(*frame);
            if (synthetic) std::this_thread::sleep_until(tick+std::chrono::microseconds(1000000/fps));
        }
    } catch (const Error& error) { if (!stop_) state({{"status","failed"},{"code",error.code},{"message",error.what()}}); }
      catch (const std::exception& error) { if (!stop_) state({{"status","failed"},{"code","CAPTURE_FAILED"},{"message",error.what()}}); }
    stop_=true; hub_.stop(); jpeg_changed_.notify_all();
    if (owned) ReleaseMutex(ownership.get());
}
void CaptureService::encode_loop() {
    uint64_t sequence=0;
    try {
        while (!stop_) {
            auto read=hub_.read(sequence,false,100ms); if (!read.frame) continue;
            auto& frame=*read.frame; sequence=frame.sequence;
            cv::Mat scaled; double scale=std::min(1.0,960.0/frame.bgr.cols);
            cv::resize(frame.bgr,scaled,{},scale,scale,cv::INTER_AREA);
            auto preview=std::make_shared<Preview>(); preview->session=frame.session; preview->sequence=sequence;
            if (!cv::imencode(".jpg",scaled,preview->jpeg,{cv::IMWRITE_JPEG_QUALITY,82})) continue;
            { std::lock_guard lock(jpeg_mutex_); preview_=preview; }
            jpeg_changed_.notify_all(); // One encode, shared by every preview window.
        }
    } catch (const std::exception& error) { emit_({{"event","runtime.log"},{"message",std::string("预览编码失败: ")+error.what()}}); }
}
static void metadata(httplib::Response& response,const FrameRead& read) {
    const auto& frame=*read.frame;
    response.set_header("X-Frame-Session",frame.session); response.set_header("X-Frame-Sequence",std::to_string(frame.sequence));
    response.set_header("X-Frame-Timestamp-Ns",std::to_string(frame.timestamp_ns)); response.set_header("X-Frame-Skipped",std::to_string(read.skipped));
    response.set_header("X-Frame-Width",std::to_string(frame.bgr.cols)); response.set_header("X-Frame-Height",std::to_string(frame.bgr.rows));
    response.set_header("X-Frame-Stride",std::to_string(frame.bgr.cols*3)); response.set_header("X-Frame-Format","BGR24");
    response.set_header("Cache-Control","no-store");
}
void CaptureService::routes() {
    server_.set_pre_routing_handler([this](const auto& request,auto& response) {
        if (request.get_header_value("Authorization")!="Bearer "+token_ && request.get_param_value("token")!=token_) {
            response.status=401; return httplib::Server::HandlerResponse::Handled;
        }
        response.set_header("Cache-Control","no-store"); return httplib::Server::HandlerResponse::Unhandled;
    });
    auto frame_route=[this](const httplib::Request& request,httplib::Response& response) {
        try {
            uint64_t after=0;
            if (request.has_param("after")) { auto value=request.get_param_value("after"); if (value.empty() || value.size()>19 || value.find_first_not_of("0123456789")!=std::string::npos) throw Error("INVALID_ARGUMENT","Invalid cursor"); after=std::stoull(value); }
            auto read=hub_.read(after,request.get_param_value("mode")=="next",200ms,request.get_param_value("session"));
            if (!read.frame) { response.status=stop_ ? 503 : 204; return; }
            if (now_ns()-read.frame->timestamp_ns>1'000'000'000ULL) {response.status=503;response.set_content("Stale video frame","text/plain");return;}
            metadata(response,read);
            if (request.path=="/snapshot.png") {
                std::vector<unsigned char> bytes; cv::imencode(".png",read.frame->bgr,bytes);
                response.set_content(reinterpret_cast<char*>(bytes.data()),bytes.size(),"image/png");
            } else response.set_content(reinterpret_cast<char*>(read.frame->bgr.data),read.frame->bgr.total()*3,"application/octet-stream");
        } catch (const Error& error) { response.status=error.code=="SESSION_CHANGED" ? 409 : 400; response.set_content(Json({{"code",error.code},{"message",error.what()}}).dump(),"application/json"); }
    };
    server_.Get("/frame",frame_route); server_.Get("/snapshot.png",frame_route);
    server_.Get("/preview",[this](const httplib::Request& request,httplib::Response& response) {
        auto session=request.get_param_value("session");
        if (stop_ || session!=status().value("session",std::string())) { response.status=409; return; }
        if (++streams_>6) { --streams_; response.status=429; return; }
        auto cursor=std::make_shared<uint64_t>(0);
        response.set_chunked_content_provider("multipart/x-mixed-replace; boundary=pokeframe",
            [this,cursor,session](size_t,httplib::DataSink& sink) {
                std::shared_ptr<const Preview> preview;
                { std::unique_lock lock(jpeg_mutex_); jpeg_changed_.wait_for(lock,200ms,[&] { return stop_ || (preview_ && preview_->sequence>*cursor); }); preview=preview_; }
                if (stop_ || (preview && preview->session!=session)) return false;
                if (!preview || preview->sequence<=*cursor) return sink.is_writable();
                *cursor=preview->sequence;
                auto header="--pokeframe\r\nContent-Type: image/jpeg\r\nContent-Length: "+std::to_string(preview->jpeg.size())+"\r\n\r\n";
                return sink.write(header.data(),header.size()) && sink.write(reinterpret_cast<const char*>(preview->jpeg.data()),preview->jpeg.size()) && sink.write("\r\n",2);
            },[this](bool) { --streams_; });
    });
}
}
