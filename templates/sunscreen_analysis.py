import cv2
import numpy as np
import mediapipe as mp

mp_face_mesh = mp.solutions.face_mesh

# ----------------------------
# Helper: landmark mask
# ----------------------------
def create_mask(image_shape, landmarks, indices):
    mask = np.zeros(image_shape[:2], dtype=np.uint8)
    points = np.array(
        [(int(landmarks[i].x * image_shape[1]),
          int(landmarks[i].y * image_shape[0])) for i in indices]
    )
    cv2.fillConvexPoly(mask, points, 255)
    return mask

# ----------------------------
# Region landmark indices
# (approximate but works well)
# ----------------------------
REGIONS = {
    "forehead": [10, 67, 109, 151, 338, 297],
    "left_cheek": [50, 101, 205, 187],
    "right_cheek": [280, 330, 425, 411],
    "nose": [1, 2, 98, 327],
    "chin": [152, 148, 176, 149]
}

# ----------------------------
# Core analysis
# ----------------------------
def analyze_sunscreen(image_bgr):
    h, w, _ = image_bgr.shape
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        refine_landmarks=True,
        max_num_faces=1
    ) as face_mesh:

        result = face_mesh.process(image_rgb)

        if not result.multi_face_landmarks:
            return {"error": "No face detected"}

        landmarks = result.multi_face_landmarks[0].landmark
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

        output = {}
        overlay = image_bgr.copy()

        for region, indices in REGIONS.items():
            mask = create_mask(image_bgr.shape, landmarks, indices)
            region_pixels = gray[mask == 255]

            if len(region_pixels) == 0:
                score = 0
            else:
                # Heuristic:
                # sunscreen → smoother + brighter highlights
                brightness = np.mean(region_pixels)
                texture = np.std(region_pixels)

                score = int(
                    np.clip(
                        (brightness * 0.6 + (100 - texture) * 0.4),
                        0, 100
                    )
                )

            output[region] = score

            # Visualization
            color = (0, 255, 0) if score > 70 else (0, 0, 255)
            overlay[mask == 255] = cv2.addWeighted(
                overlay[mask == 255], 0.6,
                np.full_like(overlay[mask == 255], color), 0.4, 0
            )

        return {
            "scores": output,
            "overlay": overlay
        }
