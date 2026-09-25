// BDSP-only resource adapter. Generator, State and Nature remain unchanged upstream code.
#include <Core/Parents/PersonalLoader.hpp>
#include <Core/Enum/Game.hpp>
#include "bdsp_data.hpp"
#include <stdexcept>

namespace PersonalLoader {
const PersonalInfo* getPersonal(Game version) {
    if ((version & Game::BDSP) == Game::None) throw std::invalid_argument("Only BDSP personal data is loaded");
    return bdsp_personal.data();
}
const PersonalInfo* getPersonal(Game version, u16 specie, u8 form) {
    getPersonal(version);
    const auto& base = bdsp_personal.at(specie);
    if (form == 0 || base.getFormStatIndex() == 0) return &base;
    return &bdsp_personal.at(base.getFormStatIndex() + form - 1);
}
}
