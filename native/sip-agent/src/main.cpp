#include "EngineStubs.h"
#include "JsonLineProtocol.h"

#include <iostream>
#include <string>

int main() {
  std::ios::sync_with_stdio(false);

  JsonLineProtocol protocol([](const std::string& line) {
    std::cout << line << "\n";
    std::cout.flush();
  });

  SipEngine engine([&protocol](const std::string& eventName, const std::string& payloadJson) {
    protocol.emitEvent(eventName, payloadJson);
  });

#ifdef SIP_AGENT_WITH_PJSIP
  protocol.emitEvent("engine_ready", "{\"version\":\"0.1.0\",\"mode\":\"native\"}");
#else
  protocol.emitEvent("engine_ready", "{\"version\":\"0.1.0\",\"mode\":\"stub\"}");
#endif

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) {
      continue;
    }

    const auto packet = protocol.parseCommandLine(line);
    if (!packet) {
      continue;
    }

    const auto result = engine.dispatch(packet->command, packet->payload);
    if (result.ok) {
      protocol.emitOk(packet->requestId, result.payloadJson);
    } else {
      protocol.emitError(packet->requestId, result.errorMessage.empty() ? "command failed" : result.errorMessage);
      protocol.emitEvent("error", "{\"code\":\"NOT_IMPLEMENTED\",\"message\":\"" + packet->command + "\"}");
    }
  }

  return 0;
}
