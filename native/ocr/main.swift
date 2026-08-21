import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

guard CommandLine.arguments.count == 2 else {
  fail("Usage: cue-ocr <image.png>")
}

let imagePath = CommandLine.arguments[1]
guard FileManager.default.isReadableFile(atPath: imagePath) else {
  fail("cue-ocr: cannot read image: \(imagePath)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

do {
  let handler = VNImageRequestHandler(url: URL(fileURLWithPath: imagePath), options: [:])
  try handler.perform([request])
  let lines = (request.results ?? [])
    .sorted { left, right in
      let leftBox = left.boundingBox
      let rightBox = right.boundingBox
      if abs(leftBox.maxY - rightBox.maxY) > 0.01 {
        return leftBox.maxY > rightBox.maxY
      }
      return leftBox.minX < rightBox.minX
    }
    .compactMap { $0.topCandidates(1).first?.string }
  print(lines.joined(separator: "\n"))
} catch {
  fail("cue-ocr: \(error.localizedDescription)")
}
