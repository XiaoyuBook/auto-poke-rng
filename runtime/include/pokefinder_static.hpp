#pragma once

#include "common.hpp"

namespace poke {

/**
 * Native BDSP static generator using the PokeFinder-compatible RNG core.
 * The command is intentionally kept behind the runtime JSON boundary so the
 * renderer never reimplements the generation algorithm in JavaScript.
 */
class PokeFinderStaticService {
public:
    Json command(const std::string& method, const Json& args);
};

}
