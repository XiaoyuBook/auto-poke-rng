#include "pokefinder_static.hpp"
#include "pokefinder_iv.hpp"
#include <Core/Gen8/Generators/StaticGenerator8.hpp>
#include <Core/Gen8/States/State8.hpp>
#include <Core/Enum/Lead.hpp>
#include "bdsp_data.hpp"
#include <algorithm>
#include <charconv>
#include <iomanip>
#include <sstream>

namespace poke {
namespace {
u64 seed(const Json& args, const char* key) {
    const auto text = args.at(key).get<std::string>();
    u64 value = 0;
    const auto [end, status] = std::from_chars(text.data(), text.data() + text.size(), value, 16);
    if (text.empty() || text.size() > 16 || status != std::errc{} || end != text.data() + text.size())
        throw Error("INVALID_ARGUMENT", std::string(key) + " 必须为 1–16 位十六进制数");
    return value;
}
std::string hex(u32 value) {
    std::ostringstream stream;
    stream << std::uppercase << std::hex << std::setw(8) << std::setfill('0') << value;
    return stream.str();
}
u8 choice(const Json& object, const char* key, int fallback, std::initializer_list<int> allowed) {
    auto value = integer(object, key, fallback, 0, 255);
    if (std::find(allowed.begin(), allowed.end(), value) == allowed.end()) throw Error("INVALID_ARGUMENT", std::string(key) + " 选项无效");
    return static_cast<u8>(value);
}
std::array<u8, 6> ivs(const Json& filter, const char* key, u8 fallback) {
    std::array<u8, 6> result; result.fill(fallback);
    if (!filter.contains(key)) return result;
    const auto& source = filter.at(key);
    if (!source.is_array() || source.size() != 6) throw Error("INVALID_ARGUMENT", "个体值范围必须包含六项");
    for (size_t i = 0; i < 6; ++i) {
        if (!source[i].is_number_integer() || source[i].get<int64_t>() < 0 || source[i].get<int64_t>() > 31)
            throw Error("INVALID_ARGUMENT", "个体值范围必须在 0–31 之间");
        result[i] = source[i].get<u8>();
    }
    return result;
}
Json generate(const Json& args) {
    const auto seed0 = seed(args, "seed0"), seed1 = seed(args, "seed1");
    if (seed0 == 0 && seed1 == 0) throw Error("INVALID_ARGUMENT", "Seed 0 与 Seed 1 不能同时为 0");
    const u32 initial = integer(args, "initialAdvances", 0, 0, 1010000000);
    // Bounded batches prevent an unfiltered billion-frame request exhausting memory.
    const u32 maximum = integer(args, "maxAdvances", 0, 0, 4095);
    const u32 offset = integer(args, "offset", 0, 0, 1000000);
    const auto lead = integer(args, "lead", 255, 0, 255);
    if (lead > 26 && lead != 255) throw Error("INVALID_ARGUMENT", "队首选项无效");
    const auto& profile = args.at("profile");
    const auto version = profile.at("version").get<std::string>();
    const Game game = version == "BD" ? Game::BD : version == "SP" ? Game::SP : Game::None;
    if (game == Game::None) throw Error("INVALID_ARGUMENT", "游戏版本必须为 BD 或 SP");
    static const auto targets = Json::parse(bdsp_targets_json);
    const auto key = args.at("target").get<std::string>();
    auto found = std::find_if(targets.begin(), targets.end(), [&](const Json& t) { return t.at("speciesKey") == key; });
    if (found == targets.end()) throw Error("INVALID_ARGUMENT", "定点目标不存在");
    const auto& t = *found;
    if (t.at("version") != "BDSP" && t.at("version") != version) throw Error("INVALID_ARGUMENT", "该定点目标不属于当前存档版本");
    const StaticTemplate8 target(game, t.at("speciesId"), t.at("form"), static_cast<Shiny>(t.at("shiny").get<u8>()),
        t.at("ability"), t.at("gender"), t.at("ivCount"), t.at("level"), t.at("fateful"), t.at("roamer"));
    const Profile8 trainer("-", game, static_cast<u16>(integer(profile, "tid", 0, 0, 65535)), static_cast<u16>(integer(profile, "sid", 0, 0, 65535)),
        profile.value("dex", false), profile.value("charm", false), profile.value("oval", false));
    const auto f = args.value("filter", Json::object());
    const bool skip = f.value("skip", false);
    auto min = ivs(f, "ivMin", 0), max = ivs(f, "ivMax", 31);
    for (size_t i = 0; i < 6; ++i) if (min[i] > max[i]) throw Error("INVALID_ARGUMENT", "个体值下限不能大于上限");
    auto heightMin = static_cast<u8>(integer(f, "heightMin", 0, 0, 255)), heightMax = static_cast<u8>(integer(f, "heightMax", 255, 0, 255));
    auto weightMin = static_cast<u8>(integer(f, "weightMin", 0, 0, 255)), weightMax = static_cast<u8>(integer(f, "weightMax", 255, 0, 255));
    if (heightMin > heightMax || weightMin > weightMax) throw Error("INVALID_ARGUMENT", "体型下限不能大于上限");
    std::array<bool, 25> natures; natures.fill(true);
    if (f.contains("natures")) {
        if (!f["natures"].is_array() || f["natures"].size() != 25) throw Error("INVALID_ARGUMENT", "性格筛选必须包含 25 项");
        for (size_t i = 0; i < 25; ++i) natures[i] = f["natures"][i].get<bool>();
    }
    std::array<bool, 16> powers; powers.fill(true);
    const auto shiny = choice(f, "shiny", 255, {0,1,2,3,255});
    const auto ability = choice(f, "ability", 255, {0,1,2,255});
    const auto gender = choice(f, "gender", 255, {0,1,2,255});
    // Upstream has no non-shiny sentinel and still checks height/weight when skip=true.
    // Adapt these two auto-bdsp-rng UI semantics at the boundary, leaving Core unchanged.
    const StateFilter filter(gender, ability, shiny == 0 ? u8{255} : shiny,
        skip ? u8{0} : heightMin, skip ? u8{255} : heightMax, skip ? u8{0} : weightMin, skip ? u8{255} : weightMax,
        skip, min, max, natures, powers);
    const StaticGenerator8 generator(initial, maximum, offset, static_cast<Lead>(lead), target, trainer, filter);
    Json rows = Json::array();
    for (const auto& state : generator.generate(seed0, seed1)) {
        if (!skip && shiny == 0 && state.getShiny() != 0) continue;
        rows.push_back({{"advances", state.getAdvances()}, {"ec", hex(state.getEC())}, {"pid", hex(state.getPID())},
            {"ivs", state.getIVs()}, {"stats", state.getStats()}, {"ability", state.getAbility()},
            {"abilityIndex", state.getAbilityIndex()}, {"gender", state.getGender()}, {"level", state.getLevel()},
            {"nature", state.getNature()}, {"shiny", state.getShiny()}, {"height", state.getHeight()},
            {"weight", state.getWeight()}, {"characteristic", state.getCharacteristic()}});
    }
    return rows;
}
}
Json PokeFinderStaticService::command(const std::string& method, const Json& args) {
    if (method == "static.generate") return generate(args);
    if (method == "iv.calculate") return calculate_ivs(args);
    throw Error("INVALID_ARGUMENT", "Unknown RNG method: " + method);
}
}
