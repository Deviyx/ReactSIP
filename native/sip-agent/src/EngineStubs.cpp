#include "EngineStubs.h"

#include <algorithm>
#include <cctype>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>

#ifdef SIP_AGENT_WITH_PJSIP
#include <pjsua2.hpp>
#endif

namespace {

std::string jsonEscape(const std::string& input) {
  std::string out;
  out.reserve(input.size());
  for (char c : input) {
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default: out.push_back(c); break;
    }
  }
  return out;
}

std::string payloadGet(const std::unordered_map<std::string, std::string>& payload, const std::string& key, const std::string& fallback = "") {
  const auto it = payload.find(key);
  return it == payload.end() ? fallback : it->second;
}

int payloadGetInt(const std::unordered_map<std::string, std::string>& payload, const std::string& key, int fallback) {
  const auto it = payload.find(key);
  if (it == payload.end()) return fallback;
  try {
    return std::stoi(it->second);
  } catch (...) {
    return fallback;
  }
}

bool payloadGetBool(const std::unordered_map<std::string, std::string>& payload, const std::string& key, bool fallback) {
  const auto it = payload.find(key);
  if (it == payload.end()) return fallback;
  std::string v = it->second;
  std::transform(v.begin(), v.end(), v.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return v == "1" || v == "true" || v == "yes";
}

} // namespace

#ifdef SIP_AGENT_WITH_PJSIP

using namespace pj;

namespace {

SipEngine::EmitEventFn gEmitEvent;
std::mutex gMutex;

std::unique_ptr<Endpoint> gEndpoint;
bool gEndpointStarted = false;

class NativeCall;
class NativeAccount;
std::shared_ptr<NativeAccount> gAccount;
std::unordered_map<std::string, std::shared_ptr<NativeCall>> gCalls;

void emitEvent(const std::string& name, const std::string& payload) {
  if (gEmitEvent) {
    gEmitEvent(name, payload);
  }
}

std::string toEngineCallId(int pjsipCallId) {
  return "native_" + std::to_string(pjsipCallId);
}

std::string parseUserFromUri(const std::string& uri) {
  const auto sipPos = uri.find("sip:");
  const auto atPos = uri.find('@');
  if (sipPos != std::string::npos && atPos != std::string::npos && atPos > sipPos + 4) {
    return uri.substr(sipPos + 4, atPos - (sipPos + 4));
  }
  return uri;
}

class NativeCall final : public Call {
public:
  explicit NativeCall(Account& account, int callId = PJSUA_INVALID_ID)
      : Call(account, callId), engineId_(toEngineCallId(callId == PJSUA_INVALID_ID ? -1 : callId)) {}

  std::string ensureEngineId() {
    if (engineId_ == "native_-1") {
      engineId_ = toEngineCallId(getId());
    }
    return engineId_;
  }

  std::string engineId() const { return engineId_; }

  void onCallState(OnCallStateParam&) override {
    CallInfo info = getInfo();
    const auto engineCallId = ensureEngineId();

    std::string state = "calling";
    if (info.state == PJSIP_INV_STATE_EARLY) state = "ringing";
    if (info.state == PJSIP_INV_STATE_CONNECTING || info.state == PJSIP_INV_STATE_CONFIRMED) state = "connected";
    if (info.state == PJSIP_INV_STATE_DISCONNECTED) {
      state = info.lastStatusCode >= 300 ? "failed" : "ended";
    }

    std::ostringstream payload;
    payload << "{\"callId\":\"" << jsonEscape(engineCallId) << "\",\"state\":\"" << state
            << "\",\"sipCode\":" << static_cast<int>(info.lastStatusCode)
            << ",\"reason\":\"" << jsonEscape(info.lastReason) << "\"}";
    emitEvent("call_state", payload.str());

    if (info.state == PJSIP_INV_STATE_DISCONNECTED) {
      std::lock_guard<std::mutex> lock(gMutex);
      gCalls.erase(engineCallId);
    }
  }

  void onCallMediaState(OnCallMediaStateParam&) override {
    CallInfo info = getInfo();
    bool mediaActive = false;

    for (unsigned i = 0; i < info.media.size(); ++i) {
      if (info.media[i].type == PJMEDIA_TYPE_AUDIO &&
          (info.media[i].status == PJSUA_CALL_MEDIA_ACTIVE || info.media[i].status == PJSUA_CALL_MEDIA_REMOTE_HOLD)) {
        try {
          AudioMedia aud = getAudioMedia(static_cast<int>(i));
          auto& adm = Endpoint::instance().audDevManager();
          AudioMedia& cap = adm.getCaptureDevMedia();
          AudioMedia& play = adm.getPlaybackDevMedia();
          cap.startTransmit(aud);
          aud.startTransmit(play);
          mediaActive = true;
        } catch (...) {
          mediaActive = false;
        }
      }
    }

    std::ostringstream payload;
    payload << "{\"callId\":\"" << jsonEscape(ensureEngineId()) << "\",\"mediaActive\":"
            << (mediaActive ? "true" : "false") << "}";
    emitEvent("call_media_state", payload.str());
  }

private:
  std::string engineId_;
};

class NativeAccount final : public Account {
public:
  explicit NativeAccount(const AccountConfig& cfg) {
    create(cfg);
  }

  void onRegState(OnRegStateParam&) override {
    AccountInfo info = getInfo();

    std::string state = "unregistered";
    if (info.regIsActive && info.regStatus == 200) state = "registered";
    else if (info.regStatus >= 300) state = "failed";
    else if (info.regStatus > 0 && info.regStatus < 300) state = "registering";

    std::ostringstream payload;
    payload << "{\"state\":\"" << state << "\",\"reason\":\""
            << jsonEscape(info.regStatusText) << "\"}";
    emitEvent("registration_state", payload.str());
  }

  void onIncomingCall(OnIncomingCallParam& prm) override {
    auto call = std::make_shared<NativeCall>(*this, prm.callId);
    CallInfo info = call->getInfo();

    std::string number = parseUserFromUri(info.remoteUri);
    std::string displayName = info.remoteContact.empty() ? number : info.remoteContact;
    const auto engineCallId = call->ensureEngineId();

    {
      std::lock_guard<std::mutex> lock(gMutex);
      gCalls[engineCallId] = call;
    }

    std::ostringstream payload;
    payload << "{\"callId\":\"" << jsonEscape(engineCallId)
            << "\",\"number\":\"" << jsonEscape(number)
            << "\",\"displayName\":\"" << jsonEscape(displayName) << "\"}";
    emitEvent("incoming_call", payload.str());
  }
};

std::shared_ptr<NativeCall> findCall(const std::string& callId) {
  std::lock_guard<std::mutex> lock(gMutex);
  const auto it = gCalls.find(callId);
  return it == gCalls.end() ? nullptr : it->second;
}

void addCall(const std::shared_ptr<NativeCall>& call) {
  std::lock_guard<std::mutex> lock(gMutex);
  gCalls[call->ensureEngineId()] = call;
}

} // namespace

bool AppEndpoint::initialize() {
  try {
    if (!gEndpoint) {
      gEndpoint = std::make_unique<Endpoint>();
      gEndpoint->libCreate();

      EpConfig epCfg;
      epCfg.logConfig.level = 3;
      epCfg.logConfig.consoleLevel = 0;
      epCfg.logConfig.msgLogging = false;
      epCfg.uaConfig.maxCalls = 8;
      gEndpoint->libInit(epCfg);
    }
    return true;
  } catch (const Error&) {
    return false;
  }
}

void AppEndpoint::shutdown() {
  try {
    if (gEndpointStarted && gEndpoint) {
      gEndpoint->libDestroy();
      gEndpointStarted = false;
    }
  } catch (...) {
  }
  gAccount.reset();
  gCalls.clear();
}

EngineCommandResult SipAccount::connect(const std::unordered_map<std::string, std::string>& payload) {
  if (!gEndpoint && !AppEndpoint().initialize()) {
    return { false, "{}", "failed to initialize endpoint" };
  }

  try {
    const int sipPort = payloadGetInt(payload, "localSipPort", 5061);

    if (!gEndpointStarted) {
      TransportConfig tcfg;
      tcfg.port = static_cast<pj_uint16_t>(sipPort);
      gEndpoint->transportCreate(PJSIP_TRANSPORT_UDP, tcfg);
      gEndpoint->libStart();
      gEndpointStarted = true;
    }

    AccountConfig acfg;
    const std::string username = payloadGet(payload, "username");
    const std::string password = payloadGet(payload, "password");
    const std::string domain = payloadGet(payload, "domain");
    const std::string displayName = payloadGet(payload, "displayName", username);

    acfg.idUri = "sip:" + username + "@" + domain;
    acfg.regConfig.registrarUri = "sip:" + domain;
    acfg.sipConfig.authCreds.push_back(AuthCredInfo("digest", "*", username, 0, password));
    acfg.sipConfig.proxies.clear();
    acfg.sipConfig.contactForced = "sip:" + username + "@" + domain;
    acfg.regConfig.timeoutSec = 300;
    acfg.regConfig.retryIntervalSec = 15;

    gAccount.reset();
    gAccount = std::make_shared<NativeAccount>(acfg);

    std::ostringstream payloadJson;
    payloadJson << "{\"message\":\"connecting\",\"user\":\"" << jsonEscape(displayName) << "\"}";
    emitEvent("registration_state", "{\"state\":\"registering\",\"reason\":\"starting registration\"}");

    return { true, payloadJson.str(), "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("connect error: ") + err.info() };
  }
}

EngineCommandResult SipAccount::disconnect() {
  try {
    if (gAccount) {
      AccountInfo info = gAccount->getInfo();
      if (info.regIsActive) {
        gAccount->setRegistration(false);
      }
      gAccount.reset();
    }
    gCalls.clear();
    emitEvent("registration_state", "{\"state\":\"unregistered\",\"reason\":\"manual disconnect\"}");
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("disconnect error: ") + err.info() };
  }
}

EngineCommandResult SipCall::makeCall(const std::unordered_map<std::string, std::string>& payload) {
  if (!gAccount) {
    return { false, "{}", "not connected" };
  }

  try {
    std::string target = payloadGet(payload, "target");
    if (target.empty()) {
      return { false, "{}", "target is required" };
    }

    if (target.rfind("sip:", 0) != 0) {
      const auto& accInfo = gAccount->getInfo();
      const auto atPos = accInfo.uri.find('@');
      const auto domain = atPos != std::string::npos ? accInfo.uri.substr(atPos + 1) : std::string();
      target = "sip:" + target + "@" + domain;
    }

    auto call = std::make_shared<NativeCall>(*gAccount);
    CallOpParam prm(true);
    prm.opt.audioCount = 1;
    prm.opt.videoCount = 0;
    call->makeCall(target, prm);
    addCall(call);

    std::ostringstream out;
    out << "{\"callId\":\"" << jsonEscape(call->ensureEngineId()) << "\"}";
    return { true, out.str(), "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("make_call error: ") + err.info() };
  }
}

EngineCommandResult SipCall::answer(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    CallOpParam prm(true);
    prm.statusCode = PJSIP_SC_OK;
    prm.opt.audioCount = 1;
    prm.opt.videoCount = 0;
    call->answer(prm);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("answer error: ") + err.info() };
  }
}

EngineCommandResult SipCall::reject(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    CallOpParam prm;
    prm.statusCode = PJSIP_SC_BUSY_HERE;
    call->hangup(prm);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("reject error: ") + err.info() };
  }
}

EngineCommandResult SipCall::hangup(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    CallOpParam prm;
    prm.statusCode = PJSIP_SC_DECLINE;
    call->hangup(prm);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("hangup error: ") + err.info() };
  }
}

EngineCommandResult SipCall::hold(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    const bool enabled = payloadGetBool(payload, "enabled", true);
    CallOpParam prm(true);
    if (enabled) {
      call->setHold(prm);
    } else {
      prm.opt.flag |= PJSUA_CALL_UNHOLD;
      call->reinvite(prm);
    }
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("hold error: ") + err.info() };
  }
}

EngineCommandResult SipCall::mute(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    const bool enabled = payloadGetBool(payload, "enabled", true);
    AudioMedia aud = call->getAudioMedia(-1);
    aud.adjustTxLevel(enabled ? 0.0f : 1.0f);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("mute error: ") + err.info() };
  }
}

EngineCommandResult SipCall::sendDTMF(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    CallSendDtmfParam prm;
    prm.digits = payloadGet(payload, "digits");
    call->sendDtmf(prm);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("send_dtmf error: ") + err.info() };
  }
}

EngineCommandResult SipCall::transfer(const std::unordered_map<std::string, std::string>& payload) {
  auto call = findCall(payloadGet(payload, "callId"));
  if (!call) return { false, "{}", "call not found" };

  try {
    CallOpParam prm(true);
    std::string target = payloadGet(payload, "target");
    if (target.empty()) {
      return { false, "{}", "target is required" };
    }

    if (target.rfind("sip:", 0) != 0 && target.rfind("sips:", 0) != 0) {
      if (target.find('@') == std::string::npos && gAccount) {
        const auto& accInfo = gAccount->getInfo();
        const auto atPos = accInfo.uri.find('@');
        if (atPos != std::string::npos && atPos + 1 < accInfo.uri.size()) {
          target += "@" + accInfo.uri.substr(atPos + 1);
        }
      }
      target = "sip:" + target;
    }
    call->xfer(target, prm);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("transfer error: ") + err.info() };
  }
}

EngineCommandResult AudioManager::listAudioDevices() {
  if (!gEndpoint) {
    return { true, "{\"inputs\":[],\"outputs\":[]}", "" };
  }

  try {
    auto& adm = Endpoint::instance().audDevManager();
    AudioDevInfoVector2 devs = adm.enumDev2();

    std::ostringstream out;
    out << "{\"inputs\":[";
    bool first = true;
    for (unsigned i = 0; i < devs.size(); ++i) {
      const auto& d = devs[i];
      if (d.inputCount <= 0) continue;
      if (!first) out << ',';
      first = false;
      out << "{\"deviceId\":\"" << i << "\",\"label\":\"" << jsonEscape(d.driver + " - " + d.name) << "\"}";
    }
    out << "],\"outputs\":[";
    first = true;
    for (unsigned i = 0; i < devs.size(); ++i) {
      const auto& d = devs[i];
      if (d.outputCount <= 0) continue;
      if (!first) out << ',';
      first = false;
      out << "{\"deviceId\":\"" << i << "\",\"label\":\"" << jsonEscape(d.driver + " - " + d.name) << "\"}";
    }
    out << "]}";

    emitEvent("audio_devices", out.str());
    return { true, out.str(), "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("list_audio_devices error: ") + err.info() };
  }
}

EngineCommandResult AudioManager::setAudioInputDevice(const std::unordered_map<std::string, std::string>& payload) {
  if (!gEndpoint) return { false, "{}", "endpoint not initialized" };
  try {
    auto& adm = Endpoint::instance().audDevManager();
    const int idx = payloadGetInt(payload, "deviceId", -1);
    if (idx < -1) return { false, "{}", "invalid deviceId" };
    adm.setCaptureDev(idx);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("set_audio_input_device error: ") + err.info() };
  }
}

EngineCommandResult AudioManager::setAudioOutputDevice(const std::unordered_map<std::string, std::string>& payload) {
  if (!gEndpoint) return { false, "{}", "endpoint not initialized" };
  try {
    auto& adm = Endpoint::instance().audDevManager();
    const int idx = payloadGetInt(payload, "deviceId", -1);
    if (idx < -1) return { false, "{}", "invalid deviceId" };
    adm.setPlaybackDev(idx);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("set_audio_output_device error: ") + err.info() };
  }
}

EngineCommandResult AudioManager::setInputVolume(const std::unordered_map<std::string, std::string>& payload) {
  if (!gEndpoint) return { false, "{}", "endpoint not initialized" };
  try {
    auto& adm = Endpoint::instance().audDevManager();
    const unsigned vol = static_cast<unsigned>(std::clamp(payloadGetInt(payload, "percent", 100), 0, 150));
    adm.setInputVolume(vol);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("set_input_volume error: ") + err.info() };
  }
}

EngineCommandResult AudioManager::setOutputVolume(const std::unordered_map<std::string, std::string>& payload) {
  if (!gEndpoint) return { false, "{}", "endpoint not initialized" };
  try {
    auto& adm = Endpoint::instance().audDevManager();
    const unsigned vol = static_cast<unsigned>(std::clamp(payloadGetInt(payload, "percent", 100), 0, 150));
    adm.setOutputVolume(vol);
    return { true, "{}", "" };
  } catch (const Error& err) {
    return { false, "{}", std::string("set_output_volume error: ") + err.info() };
  }
}

#else

bool AppEndpoint::initialize() {
  return true;
}

void AppEndpoint::shutdown() {
}

EngineCommandResult SipAccount::connect(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "connect not implemented: compile with SIP_AGENT_WITH_PJSIP and wire PJSUA2" };
}

EngineCommandResult SipAccount::disconnect() {
  return { true, "{}", "" };
}

EngineCommandResult SipCall::makeCall(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "make_call not implemented" };
}

EngineCommandResult SipCall::answer(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "answer not implemented" };
}

EngineCommandResult SipCall::reject(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "reject not implemented" };
}

EngineCommandResult SipCall::hangup(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "hangup not implemented" };
}

EngineCommandResult SipCall::hold(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "hold not implemented" };
}

EngineCommandResult SipCall::mute(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "mute not implemented" };
}

EngineCommandResult SipCall::sendDTMF(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "send_dtmf not implemented" };
}

EngineCommandResult SipCall::transfer(const std::unordered_map<std::string, std::string>&) {
  return { false, "{}", "transfer not implemented" };
}

EngineCommandResult AudioManager::listAudioDevices() {
  return { true, "{\"inputs\":[],\"outputs\":[]}", "" };
}

EngineCommandResult AudioManager::setAudioInputDevice(const std::unordered_map<std::string, std::string>&) {
  return { true, "{}", "" };
}

EngineCommandResult AudioManager::setAudioOutputDevice(const std::unordered_map<std::string, std::string>&) {
  return { true, "{}", "" };
}

EngineCommandResult AudioManager::setInputVolume(const std::unordered_map<std::string, std::string>&) {
  return { true, "{}", "" };
}

EngineCommandResult AudioManager::setOutputVolume(const std::unordered_map<std::string, std::string>&) {
  return { true, "{}", "" };
}

#endif

SipEngine::SipEngine(EmitEventFn emitEvent)
  : emitEvent_(std::move(emitEvent)) {
#ifdef SIP_AGENT_WITH_PJSIP
  gEmitEvent = emitEvent_;
#endif
  endpoint_.initialize();
}

EngineCommandResult SipEngine::dispatch(const std::string& command, const std::unordered_map<std::string, std::string>& payload) {
  if (command == "connect") return account_.connect(payload);
  if (command == "disconnect") return account_.disconnect();
  if (command == "make_call") return call_.makeCall(payload);
  if (command == "answer") return call_.answer(payload);
  if (command == "reject") return call_.reject(payload);
  if (command == "hangup") return call_.hangup(payload);
  if (command == "hold") return call_.hold(payload);
  if (command == "mute") return call_.mute(payload);
  if (command == "send_dtmf") return call_.sendDTMF(payload);
  if (command == "transfer") return call_.transfer(payload);
  if (command == "list_audio_devices") return audio_.listAudioDevices();
  if (command == "set_audio_input_device") return audio_.setAudioInputDevice(payload);
  if (command == "set_audio_output_device") return audio_.setAudioOutputDevice(payload);
  if (command == "set_input_volume") return audio_.setInputVolume(payload);
  if (command == "set_output_volume") return audio_.setOutputVolume(payload);
  if (command == "ping") return { true, "{\"pong\":true}", "" };

  return notImplemented(command);
}

EngineCommandResult SipEngine::notImplemented(const std::string& command) const {
  std::ostringstream oss;
  oss << command << " not implemented";
  return { false, "{}", oss.str() };
}
