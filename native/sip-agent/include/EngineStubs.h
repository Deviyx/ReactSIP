#pragma once

#include <functional>
#include <string>
#include <unordered_map>

struct EngineCommandResult {
  bool ok { false };
  std::string payloadJson { "{}" };
  std::string errorMessage;
};

class AppEndpoint {
public:
  bool initialize();
  void shutdown();
};

class SipAccount {
public:
  EngineCommandResult connect(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult disconnect();
};

class SipCall {
public:
  EngineCommandResult makeCall(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult answer(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult reject(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult hangup(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult hold(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult mute(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult sendDTMF(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult transfer(const std::unordered_map<std::string, std::string>& payload);
};

class AudioManager {
public:
  EngineCommandResult listAudioDevices();
  EngineCommandResult setAudioInputDevice(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult setAudioOutputDevice(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult setInputVolume(const std::unordered_map<std::string, std::string>& payload);
  EngineCommandResult setOutputVolume(const std::unordered_map<std::string, std::string>& payload);
};

class SipEngine {
public:
  using EmitEventFn = std::function<void(const std::string&, const std::string&)>;

  explicit SipEngine(EmitEventFn emitEvent);

  EngineCommandResult dispatch(const std::string& command, const std::unordered_map<std::string, std::string>& payload);

private:
  EngineCommandResult notImplemented(const std::string& command) const;

  EmitEventFn emitEvent_;
  AppEndpoint endpoint_;
  SipAccount account_;
  SipCall call_;
  AudioManager audio_;
};
