#include "JsonLineProtocol.h"

#include <regex>

JsonLineProtocol::JsonLineProtocol(EmitLineFn emitLine)
  : emitLine_(std::move(emitLine)) {}

std::optional<CommandPacket> JsonLineProtocol::parseCommandLine(const std::string& line) const {
  const auto requestId = extractString(line, "requestId");
  const auto command = extractString(line, "command");
  if (!requestId || !command) {
    return std::nullopt;
  }

  CommandPacket packet;
  packet.requestId = *requestId;
  packet.command = *command;
  packet.payload = extractPayload(line);
  return packet;
}

void JsonLineProtocol::emitEvent(const std::string& eventName, const std::string& payloadJson) const {
  emitLine_("{\"type\":\"event\",\"event\":\"" + escape(eventName) + "\",\"payload\":" + payloadJson + "}");
}

void JsonLineProtocol::emitOk(const std::string& requestId, const std::string& payloadJson) const {
  emitLine_("{\"type\":\"response\",\"requestId\":\"" + escape(requestId) + "\",\"ok\":true,\"payload\":" + payloadJson + "}");
}

void JsonLineProtocol::emitError(const std::string& requestId, const std::string& message) const {
  emitLine_("{\"type\":\"response\",\"requestId\":\"" + escape(requestId) + "\",\"ok\":false,\"error\":\"" + escape(message) + "\"}");
}

std::string JsonLineProtocol::escape(const std::string& value) const {
  std::string out;
  out.reserve(value.size());
  for (char c : value) {
    if (c == '\\' || c == '"') out.push_back('\\');
    out.push_back(c);
  }
  return out;
}

std::optional<std::string> JsonLineProtocol::extractString(const std::string& json, const std::string& key) const {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
  std::smatch match;
  if (std::regex_search(json, match, pattern) && match.size() > 1) {
    return match[1].str();
  }
  return std::nullopt;
}

std::unordered_map<std::string, std::string> JsonLineProtocol::extractPayload(const std::string& json) const {
  std::unordered_map<std::string, std::string> out;
  const auto payloadPos = json.find("\"payload\"");
  if (payloadPos == std::string::npos) return out;

  const auto braceStart = json.find('{', payloadPos);
  const auto braceEnd = json.find('}', braceStart);
  if (braceStart == std::string::npos || braceEnd == std::string::npos || braceEnd <= braceStart) return out;

  const std::string payloadBlock = json.substr(braceStart, braceEnd - braceStart + 1);
  const std::regex kvPattern("\\\"([^\\\"]+)\\\"\\s*:\\s*(\\\"([^\\\"]*)\\\"|[0-9.+-]+|true|false)");
  for (std::sregex_iterator it(payloadBlock.begin(), payloadBlock.end(), kvPattern), end; it != end; ++it) {
    const auto key = (*it)[1].str();
    std::string raw = (*it)[2].str();
    if (raw.size() >= 2 && raw.front() == '"' && raw.back() == '"') {
      raw = raw.substr(1, raw.size() - 2);
    }
    out[key] = raw;
  }

  return out;
}
