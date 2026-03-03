cmake_minimum_required(VERSION 3.20)
project(sip_agent LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(SIP_AGENT_WITH_PJSIP "Build with PJSIP/PJSUA2 integration" OFF)

add_executable(sip-agent
  src/main.cpp
  src/JsonLineProtocol.cpp
  src/EngineStubs.cpp
)

target_include_directories(sip-agent PRIVATE include)

if(SIP_AGENT_WITH_PJSIP)
  target_compile_definitions(sip-agent PRIVATE SIP_AGENT_WITH_PJSIP=1)

  if(NOT DEFINED PJSIP_DIR)
    if(DEFINED ENV{PJSIP_DIR})
      set(PJSIP_DIR $ENV{PJSIP_DIR})
    else()
      message(FATAL_ERROR "SIP_AGENT_WITH_PJSIP=ON requires PJSIP_DIR (or environment PJSIP_DIR).")
    endif()
  endif()

  message(STATUS "PJSIP integration enabled with PJSIP_DIR=${PJSIP_DIR}")

  target_include_directories(sip-agent PRIVATE
    ${PJSIP_DIR}/include
    ${PJSIP_DIR}/pjsip/include
    ${PJSIP_DIR}/pjlib/include
    ${PJSIP_DIR}/pjlib-util/include
    ${PJSIP_DIR}/pjmedia/include
    ${PJSIP_DIR}/pjnath/include
    ${PJSIP_DIR}/third_party
  )

  target_link_directories(sip-agent PRIVATE
    ${PJSIP_DIR}/lib
    ${PJSIP_DIR}/pjsip/lib
    ${PJSIP_DIR}/pjlib/lib
    ${PJSIP_DIR}/pjlib-util/lib
    ${PJSIP_DIR}/pjmedia/lib
    ${PJSIP_DIR}/pjnath/lib
  )

  file(GLOB_RECURSE PJSIP_LIBS
    "${PJSIP_DIR}/*.lib"
  )

  set(PJSIP_CORE_LIBS "")
  foreach(_lib IN LISTS PJSIP_LIBS)
    get_filename_component(_name "${_lib}" NAME_WE)
    string(TOLOWER "${_name}" _name_lc)
    if(
      _name_lc MATCHES "^pjsua2" OR
      _name_lc MATCHES "^pjsua" OR
      _name_lc MATCHES "^pjsip" OR
      _name_lc MATCHES "^pjmedia" OR
      _name_lc MATCHES "^pjnath" OR
      _name_lc MATCHES "^pjlib" OR
      _name_lc MATCHES "^libsrtp" OR
      _name_lc MATCHES "^libspeex" OR
      _name_lc MATCHES "^libgsm" OR
      _name_lc MATCHES "^libilbc" OR
      _name_lc MATCHES "^libresample" OR
      _name_lc MATCHES "^libmilenage" OR
      _name_lc MATCHES "^libg7221"
    )
      list(APPEND PJSIP_CORE_LIBS "${_lib}")
    endif()
  endforeach()

  list(LENGTH PJSIP_CORE_LIBS PJSIP_CORE_LIBS_COUNT)
  if(PJSIP_CORE_LIBS_COUNT EQUAL 0)
    message(FATAL_ERROR "No PJSIP libraries found under ${PJSIP_DIR}. Build pjproject libs first.")
  endif()

  message(STATUS "Detected ${PJSIP_CORE_LIBS_COUNT} PJSIP libraries for linking")

  target_link_libraries(sip-agent PRIVATE
    ${PJSIP_CORE_LIBS}
    ws2_32
    ole32
    uuid
    winmm
    iphlpapi
    secur32
  )
endif()

if(MSVC)
  target_compile_options(sip-agent PRIVATE /W4)
else()
  target_compile_options(sip-agent PRIVATE -Wall -Wextra -Wpedantic)
endif()
