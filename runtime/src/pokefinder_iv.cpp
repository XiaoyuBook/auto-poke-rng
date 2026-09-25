#include "pokefinder_iv.hpp"
#include <Core/Enum/Game.hpp>
#include <Core/Parents/PersonalLoader.hpp>
#include <Core/Parents/PersonalInfo.hpp>
#include <Core/Util/IVChecker.hpp>
#include <Core/Util/Nature.hpp>
#include <algorithm>

namespace poke {
namespace {
u8 option(const Json& args, const char* name, int maximum) {
    const int value = integer(args, name, 255, 0, 255);
    if (value > maximum && value != 255) throw Error("INVALID_ARGUMENT", std::string(name) + " 选项无效");
    return static_cast<u8>(value);
}
using Candidates = std::array<std::vector<u8>, 6>;
Candidates shedinja_ivs(const PersonalInfo* info, const std::vector<std::array<u16, 6>>& stats,
                       const std::vector<u8>& levels, u8 nature, u8 characteristic, u8 hiddenPower) {
    Candidates result;
    if (std::any_of(stats.begin(), stats.end(), [](const auto& row) { return row[0] != 1; })) return result;
    // Core assumes regular HP. Use it to solve the other five stats, then let
    // HP vary over 0..31 because Shedinja's fixed 1 HP contains no IV information.
    auto adjusted = stats;
    for (size_t i = 0; i < adjusted.size(); ++i) adjusted[i][0] = Nature::computeStat(info->getStat(0), 0, 0, levels[i], 0);
    auto candidates = IVChecker::calculateIVRange(info->getStats(), adjusted, levels, nature, 255, 255);
    candidates[0].clear();
    for (u8 iv = 0; iv < 32; ++iv) candidates[0].push_back(iv);
    constexpr int order[] = {0, 1, 2, 5, 3, 4};
    constexpr int parityBit[] = {0, 1, 2, 4, 5, 3};
    const int charStat = characteristic == 255 ? -1 : order[characteristic / 5];
    // Enumerate the characteristic's highest IV and Hidden Power parity masks;
    // union only complete, jointly valid combinations (at most 32 * 64 masks).
    for (int highest = characteristic == 255 ? 31 : 0; highest <= 31; ++highest) {
        if (charStat >= 0 && highest % 5 != characteristic % 5) continue;
        for (int mask = 0; mask < (hiddenPower == 255 ? 1 : 64); ++mask) {
            if (hiddenPower != 255 && mask * 15 / 63 != hiddenPower) continue;
            Candidates group;
            for (int i = 0; i < 6; ++i) for (u8 iv : candidates[i]) {
                if ((i == charStat ? iv == highest : iv <= highest) &&
                    (hiddenPower == 255 || iv % 2 == ((mask >> parityBit[i]) & 1))) group[i].push_back(iv);
            }
            if (std::any_of(group.begin(), group.end(), [](const auto& values) { return values.empty(); })) continue;
            for (int i = 0; i < 6; ++i) result[i].insert(result[i].end(), group[i].begin(), group[i].end());
        }
    }
    for (auto& values : result) { std::sort(values.begin(), values.end()); values.erase(std::unique(values.begin(), values.end()), values.end()); }
    return result;
}
}
Json calculate_ivs(const Json& args) {
    const auto species = static_cast<u16>(integer(args, "species", 0, 1, 493));
    const auto* base = PersonalLoader::getPersonal(Game::BD, species, 0);
    if (!base->getPresent()) throw Error("INVALID_ARGUMENT", "该宝可梦不在 BDSP 数据中");
    const auto form = static_cast<u8>(integer(args, "form", 0, 0, std::max(1, int(base->getFormCount())) - 1));
    const auto* info = PersonalLoader::getPersonal(Game::BD, species, form);
    const auto nature = option(args, "nature", 24);
    const auto characteristic = option(args, "characteristic", 29);
    const auto hiddenPower = option(args, "hiddenPower", 15);
    const auto& entries = args.at("entries");
    if (!entries.is_array() || entries.empty() || entries.size() > 100) throw Error("INVALID_ARGUMENT", "请输入 1–100 组能力值");
    std::vector<std::array<u16, 6>> stats;
    std::vector<u8> levels;
    for (const auto& entry : entries) {
        const auto level = static_cast<u8>(integer(entry, "level", 0, 1, 100));
        const auto& values = entry.at("stats");
        if (!values.is_array() || values.size() != 6) throw Error("INVALID_ARGUMENT", "每组能力值必须包含六项");
        std::array<u16, 6> row;
        for (size_t i = 0; i < 6; ++i) {
            if (!values[i].is_number_integer() || values[i].get<int64_t>() < 1 || values[i].get<int64_t>() > 9999)
                throw Error("INVALID_ARGUMENT", "能力值必须为 1–9999 的整数");
            row[i] = values[i].get<u16>();
        }
        stats.emplace_back(row); levels.emplace_back(level);
    }
    std::array<std::vector<u8>, 6> ivs;
    if (species == 292) {
        ivs = shedinja_ivs(info, stats, levels, nature, characteristic, hiddenPower);
    } else {
        ivs = IVChecker::calculateIVRange(info->getStats(), stats, levels, nature, characteristic, hiddenPower);
    }
    const bool possible = std::all_of(ivs.begin(), ivs.end(), [](const auto& values) { return !values.empty(); });
    const u8 level = *std::max_element(levels.begin(), levels.end());
    Json next = Json::array();
    if (possible) {
        const auto nextLevels = IVChecker::nextLevel(info->getStats(), ivs, level, nature);
        for (size_t i = 0; i < 6; ++i) next.push_back(nextLevels[i] > level && !(species == 292 && i == 0) ? Json(nextLevels[i]) : Json(nullptr));
    } else {
        for (auto& values : ivs) values.clear();
        for (size_t i = 0; i < 6; ++i) next.push_back(nullptr);
    }
    return {{"ivs", ivs}, {"baseStats", info->getStats()}, {"nextLevels", next}, {"possible", possible}};
}
}
