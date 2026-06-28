import Foundation
import AVFoundation
import Vision
import simd

/// Camera-driven hand-gesture control for the 3D space (req 4), the "Tony Stark
/// moving holograms with his hands" interaction:
///   • Pinch (thumb-tip ↔ index-tip close) + move → drag the selected object.
///   • Two hands moving apart / together → scale the selected object.
///
/// Uses `VNDetectHumanHandPoseRequest` on the front camera. Can be toggled off
/// by button or voice (handled in `StudioModel.setGestureControl` /
/// `CommandRouter`). Heavy lifting (camera + Vision) is isolated here so the
/// rest of the app has no camera dependency.
@MainActor
final class HandPoseController: NSObject {
    var onPinchDrag: ((SIMD3<Float>) -> Void)?
    var onTwoHandScale: ((Float) -> Void)?

    private let captureSession = AVCaptureSession()
    private let videoQueue = DispatchQueue(label: "com.actig.handpose.video")

    private var lastPinchPoint: CGPoint?
    private var lastTwoHandDistance: CGFloat?
    private var running = false

    /// Start the camera + Vision pipeline (after camera permission).
    func start() {
        guard !running else { return }
        Task {
            guard await requestCameraAccess() else { return }
            configureSession()
            videoQueue.async { [weak self] in self?.captureSession.startRunning() }
            running = true
        }
    }

    func stop() {
        guard running else { return }
        captureSession.stopRunning()
        lastPinchPoint = nil
        lastTwoHandDistance = nil
        running = false
    }

    // MARK: Setup

    private func configureSession() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .vga640x480 // light-weight for Vision
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
           let input = try? AVCaptureDeviceInput(device: device),
           captureSession.canAddInput(input) {
            captureSession.addInput(input)
        }
        let output = AVCaptureVideoDataOutput()
        output.setSampleBufferDelegate(self, queue: videoQueue)
        if captureSession.canAddOutput(output) { captureSession.addOutput(output) }
        captureSession.commitConfiguration()
    }

    private func requestCameraAccess() async -> Bool {
        await withCheckedContinuation { cont in
            AVCaptureDevice.requestAccess(for: .video) { cont.resume(returning: $0) }
        }
    }

    // MARK: Gesture interpretation

    fileprivate func process(observations: [VNHumanHandPoseObservation]) {
        switch observations.count {
        case 1:
            handlePinch(observations[0])
            lastTwoHandDistance = nil
        case 2:
            handleTwoHandScale(observations[0], observations[1])
            lastPinchPoint = nil
        default:
            lastPinchPoint = nil
            lastTwoHandDistance = nil
        }
    }

    private func handlePinch(_ obs: VNHumanHandPoseObservation) {
        guard
            let thumb = try? obs.recognizedPoint(.thumbTip),
            let index = try? obs.recognizedPoint(.indexTip),
            thumb.confidence > 0.3, index.confidence > 0.3
        else { lastPinchPoint = nil; return }

        let pinchDistance = hypot(thumb.location.x - index.location.x,
                                  thumb.location.y - index.location.y)
        let isPinching = pinchDistance < 0.05
        let mid = CGPoint(x: (thumb.location.x + index.location.x) / 2,
                          y: (thumb.location.y + index.location.y) / 2)

        guard isPinching else { lastPinchPoint = nil; return }
        defer { lastPinchPoint = mid }
        guard let last = lastPinchPoint else { return }

        let dx = Float(mid.x - last.x)
        let dy = Float(mid.y - last.y)
        // Vision's normalized coords → small world-space drag.
        onPinchDrag?([dx * 0.5, dy * 0.5, 0])
    }

    private func handleTwoHandScale(_ a: VNHumanHandPoseObservation, _ b: VNHumanHandPoseObservation) {
        guard
            let pa = try? a.recognizedPoint(.wrist),
            let pb = try? b.recognizedPoint(.wrist),
            pa.confidence > 0.3, pb.confidence > 0.3
        else { lastTwoHandDistance = nil; return }

        let distance = hypot(pa.location.x - pb.location.x, pa.location.y - pb.location.y)
        defer { lastTwoHandDistance = distance }
        guard let last = lastTwoHandDistance, last > 0.01 else { return }

        let factor = Float(distance / last)
        // Ignore jitter; only apply meaningful changes.
        if abs(factor - 1) > 0.01 { onTwoHandScale?(factor) }
    }
}

extension HandPoseController: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput,
                                   didOutput sampleBuffer: CMSampleBuffer,
                                   from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 2
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
        try? handler.perform([request])
        let results = request.results ?? []
        Task { @MainActor in self.process(observations: results) }
    }
}
