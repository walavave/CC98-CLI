export function renderUserGenderPrefix(profile: Record<string, unknown>): string {
  const raw = profile.gender
    ?? profile.Gender
    ?? profile.sex
    ?? profile.Sex
    ?? profile.genderType
    ?? profile.GenderType
    ?? profile.sexType
    ?? profile.SexType
    ?? profile.genderValue
    ?? profile.GenderValue
    ?? profile.sexValue
    ?? profile.SexValue
    ?? profile.genderText
    ?? profile.GenderText
    ?? profile.sexText
    ?? profile.SexText
    ?? profile.genderString
    ?? profile.GenderString
    ?? profile.sexString
    ?? profile.SexString;

  if (raw === undefined || raw === null) {
    return "";
  }

  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (
    normalized === "女" ||
    normalized === "female" ||
    normalized === "f" ||
    normalized === "0" ||
    normalized === "2"
  ) {
    return "♀ ";
  }

  if (
    normalized === "男" ||
    normalized === "male" ||
    normalized === "m" ||
    normalized === "1"
  ) {
    return "♂ ";
  }

  return "";
}
