#pragma once

#include <functional>
#include <optional>
#include <string>
#include <unordered_map>

struct CommandPacket {
  std::string requestId;
  std::string command;
  std::unordered_map<std::string, std::string> payload;
};

class JsonLineProtocol {
public:
  using EmitLineFn = std::function<void(const std::string&)>;

  explicit JsonLineProtocol(EmitLineFn emitLine);

  std::optional<CommandPacket> parseCommandLine(const std::string& line) const;
  void emitEvent(const std::string& eventName, const std::string& payloadJson) const;
  void emitOk(const std::string& requestId, const std::string& payloadJson = "{}") const;
  void emitError(const std::string& requestId, const std::string& message) const;

private:
  std::string escape(const std::string& value) const;
  std::optional<std::string> extractString(const std::string& json, const std::string& key) const;
  std::unordered_map<std::string, std::string> extractPayload(const std::string& json) const;

  EmitLineFn emitLine_;
};
