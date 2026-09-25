cmake_minimum_required(VERSION 3.24)
project(auto_poke_runtime VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT WIN32)
  message(FATAL_ERROR "The device runtime currently targets Windows x64.")
endif()
find_package(OpenCV 4.12 REQUIRED COMPONENTS core imgproc imgcodecs videoio)
set(DEPS "${CMAKE_CURRENT_SOURCE_DIR}/../.deps")
function(download_header name url hash)
  if(NOT EXISTS "${DEPS}/${name}")
    file(DOWNLOAD "${url}" "${DEPS}/${name}" EXPECTED_HASH "SHA256=${hash}" TLS_VERIFY ON)
  endif()
  file(SHA256 "${DEPS}/${name}" actual)
  if(NOT actual STREQUAL hash)
    message(FATAL_ERROR "Dependency checksum mismatch: ${name}")
  endif()
endfunction()
download_header(json.hpp https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63)
download_header(httplib.h https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.20.1/httplib.h 7d3f813d05dad23b9c66eb6d9c1ff3d66f6acfaf6e5900ce960f7990e78079ea)
set(POKEFINDER "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/PokeFinder")
find_program(NODE_EXECUTABLE node REQUIRED)
execute_process(COMMAND "${NODE_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../tools/generate-bdsp-data.mjs" COMMAND_ERROR_IS_FATAL ANY)
add_library(pokefinder_bdsp STATIC
  "${POKEFINDER}/Core/Gen8/Generators/StaticGenerator8.cpp"
  "${POKEFINDER}/Core/Gen8/Profile8.cpp"
  "${POKEFINDER}/Core/Parents/Profile.cpp"
  "${POKEFINDER}/Core/Parents/States/State.cpp"
  "${POKEFINDER}/Core/Parents/Filters/StateFilter.cpp"
  "${POKEFINDER}/Core/RNG/Xorshift.cpp"
  "${POKEFINDER}/Core/RNG/Xoroshiro.cpp"
  "${POKEFINDER}/Core/Util/Nature.cpp"
  "${POKEFINDER}/Core/Util/IVChecker.cpp"
  src/bdsp_personal_loader.cpp)
target_include_directories(pokefinder_bdsp PUBLIC "${POKEFINDER}" PRIVATE generated)
set_target_properties(pokefinder_bdsp PROPERTIES CXX_STANDARD 23)
if(MSVC)
  target_compile_options(pokefinder_bdsp PRIVATE /utf-8 /EHsc)
endif()
add_library(runtime_core src/platform.cpp src/frame_hub.cpp src/shared_frames.cpp src/capture.cpp src/controller.cpp src/pokefinder_static.cpp src/pokefinder_iv.cpp)
target_include_directories(runtime_core PUBLIC include "${DEPS}" ${OpenCV_INCLUDE_DIRS} PRIVATE generated)
target_link_libraries(runtime_core PUBLIC pokefinder_bdsp)
target_compile_definitions(runtime_core PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
target_link_libraries(runtime_core PUBLIC ${OpenCV_LIBS} mfplat mf mfuuid strmiids ole32 oleaut32 advapi32 ws2_32)
if(MSVC)
  target_compile_options(runtime_core PUBLIC /utf-8 /EHsc /W4)
endif()
add_executable(poke-runtime src/main.cpp)
target_link_libraries(poke-runtime PRIVATE runtime_core)
set_target_properties(poke-runtime PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bin")
add_custom_command(TARGET poke-runtime POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_RUNTIME_DLLS:poke-runtime> $<TARGET_FILE_DIR:poke-runtime> COMMAND_EXPAND_LISTS)
enable_testing()
add_executable(runtime-tests tests/core_tests.cpp)
target_link_libraries(runtime-tests PRIVATE runtime_core)
add_custom_command(TARGET runtime-tests POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_RUNTIME_DLLS:runtime-tests> $<TARGET_FILE_DIR:runtime-tests> COMMAND_EXPAND_LISTS)
add_test(NAME runtime-core COMMAND runtime-tests)
