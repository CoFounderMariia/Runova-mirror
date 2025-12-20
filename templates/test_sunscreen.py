import cv2
from sunscreen_analysis import analyze_sunscreen

img = cv2.imread("IMG_5322.JPG")
result = analyze_sunscreen(img)

print(result["scores"])
cv2.imshow("Overlay", result["overlay"])
cv2.waitKey(0)
