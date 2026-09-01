require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "TrackingNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/masterprj/master-prj-native-2.git", :tag => "#{s.version}" }

  # Hand-written implementations are Swift only; the Objective-C++ autolinking
  # glue under nitrogen/generated is machine-generated, never edited by hand.
  s.source_files = [
    "ios/**/*.swift"
  ]

  # MediaPipe models, bundled into the app so no manual download step exists.
  s.resources = ["assets/*.task"]

  load 'nitrogen/generated/ios/TrackingNative+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'MediaPipeTasksVision', '~> 1.0.0'
  s.dependency 'VisionCamera'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
